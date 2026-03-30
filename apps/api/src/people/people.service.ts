import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { Readable } from 'stream';
import * as sharp from 'sharp';
import axios from 'axios';

const ML_URL = process.env.ML_SERVICE_URL || 'http://ml:3003';

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async findAll(ownerId: string) {
    const people = await this.prisma.person.findMany({
      where: { ownerId },
      include: {
        faces: {
          take: 1,
          where: { asset: { isDeleted: false } },
          include: { asset: { select: { id: true, fileName: true } } },
        },
        _count: { select: { faces: { where: { asset: { isDeleted: false } } } } },
      },
      orderBy: { name: 'asc' },
    });

    return people
      .filter((p) => p._count.faces > 0)
      .map((p) => ({
        id: p.id,
        name: p.name,
        faceCount: p._count.faces,
        coverFaceId: p.coverFaceId,
        coverAssetId: p.faces[0]?.asset?.id ?? null,
        createdAt: p.createdAt,
      }));
  }

  async findOne(ownerId: string, personId: string) {
    const person = await this.prisma.person.findFirst({
      where: { id: personId, ownerId },
      include: { _count: { select: { faces: true } } },
    });
    if (!person) throw new NotFoundException('Person not found');
    return person;
  }

  async findAssets(ownerId: string, personId: string, page = 1, limit = 50) {
    await this.findOne(ownerId, personId);

    const skip = (page - 1) * limit;
    const where = { personId, ownerId, asset: { isDeleted: false } };
    const faces = await this.prisma.face.findMany({
      where,
      include: {
        asset: true,
      },
      orderBy: { asset: { fileCreatedAt: 'desc' } },
      skip,
      take: limit,
    });

    const total = await this.prisma.face.count({ where });

    // Deduplicate by assetId (multiple faces in one photo)
    const seen = new Set<string>();
    const assets = [];
    for (const face of faces) {
      if (!seen.has(face.assetId)) {
        seen.add(face.assetId);
        assets.push({ ...face.asset, fileSizeBytes: face.asset.fileSizeBytes.toString() });
      }
    }

    return { assets, total, page, limit };
  }

  async rename(ownerId: string, personId: string, name: string) {
    await this.findOne(ownerId, personId);
    return this.prisma.person.update({
      where: { id: personId },
      data: { name },
    });
  }

  async remove(ownerId: string, personId: string) {
    await this.findOne(ownerId, personId);
    await this.prisma.face.updateMany({
      where: { personId, ownerId },
      data: { personId: null },
    });
    await this.prisma.person.delete({ where: { id: personId } });
    await this.invalidateFaceCrop(personId);
  }

  async mergePeople(ownerId: string, sourceId: string, targetId: string) {
    await this.findOne(ownerId, sourceId);
    await this.findOne(ownerId, targetId);

    await this.prisma.face.updateMany({
      where: { personId: sourceId, ownerId },
      data: { personId: targetId },
    });
    await this.prisma.person.delete({ where: { id: sourceId } });
    // Invalidate both: source is gone, target's best face may have changed
    await Promise.all([
      this.invalidateFaceCrop(sourceId),
      this.invalidateFaceCrop(targetId),
    ]);
    return this.prisma.person.findFirst({ where: { id: targetId } });
  }

  async clusterFaces(ownerId: string): Promise<{ created: number; updated: number; total: number }> {
    // Wipe all auto-generated people (empty name OR "Person N") — preserve user-renamed ones
    const autoPeople = await this.prisma.person.findMany({
      where: { ownerId, OR: [{ name: '' }, { name: { startsWith: 'Person ' } }] },
      select: { id: true },
    });
    if (autoPeople.length > 0) {
      const autoIds = autoPeople.map((p) => p.id);
      await this.prisma.face.updateMany({
        where: { ownerId, personId: { in: autoIds } },
        data: { personId: null },
      });
      await this.prisma.person.deleteMany({ where: { id: { in: autoIds } } });
    }

    // Load faces with high confidence only (≥0.6 removes background/noise false-positives)
    const faces = await this.prisma.face.findMany({
      where: { ownerId, confidence: { gte: 0.6 } },
      select: { id: true, embedding: true },
    });

    if (faces.length === 0) return { created: 0, updated: 0, total: 0 };

    const payload = faces.map((f) => ({
      face_id: f.id,
      embedding: f.embedding as number[],
    }));

    // threshold=0.6 gives ~same-person tolerance for InsightFace buffalo_sc embeddings
    const res = await axios.post(
      `${ML_URL}/cluster/faces`,
      { faces: payload, threshold: 0.5 },
      { timeout: 180000 },
    );

    const clusters: { face_id: string; cluster_id: number }[] = res.data.clusters;

    // Group by cluster_id, include all clusters (singletons = person in one photo)
    const clusterMap = new Map<number, string[]>();
    for (const c of clusters) {
      if (c.cluster_id < 0) continue;
      if (!clusterMap.has(c.cluster_id)) clusterMap.set(c.cluster_id, []);
      clusterMap.get(c.cluster_id)!.push(c.face_id);
    }

    const meaningfulClusters = [...clusterMap.entries()];

    let created = 0;

    for (const [, faceIds] of meaningfulClusters) {
      const person = await this.prisma.person.create({
        data: { ownerId, name: '' },
      });

      await this.prisma.face.updateMany({
        where: { id: { in: faceIds } },
        data: { personId: person.id },
      });

      // Cover = largest face (best for thumbnail crop quality), confidence as tiebreaker
      const allFaces = await this.prisma.face.findMany({
        where: { id: { in: faceIds } },
        select: { id: true, bbox: true, confidence: true },
      });
      const bestFace = allFaces.sort((a, b) => {
        const area = (f: any) => {
          const bb = f.bbox as any;
          return (bb.x2 - bb.x1) * (bb.y2 - bb.y1);
        };
        const diff = area(b) - area(a);
        return diff !== 0 ? diff : b.confidence - a.confidence;
      })[0];
      if (bestFace) {
        await this.prisma.person.update({
          where: { id: person.id },
          data: { coverFaceId: bestFace.id },
        });
      }

      created++;
    }

    return { created, updated: 0, total: created };
  }

  async getFaceThumbnailUrl(ownerId: string, faceId: string) {
    const face = await this.prisma.face.findFirst({
      where: { id: faceId, ownerId },
      include: { asset: { select: { thumbnailLargePath: true } } },
    });
    if (!face) throw new NotFoundException('Face not found');
    return { assetId: face.assetId, bbox: face.bbox };
  }

  /** Returns a tight face crop for the person's best face as a webp Buffer.
   *  The crop is generated once and cached in S3 at face-crops/{personId}.webp. */
  async getFaceCrop(ownerId: string, personId: string): Promise<Buffer> {
    const cacheKey = `face-crops/${personId}.webp`;

    // Serve from cache if available
    try {
      const stream = await this.storage.getStream(cacheKey);
      return streamToBuffer(stream);
    } catch { /* not cached yet */ }

    // Find the best face (highest confidence, non-deleted asset)
    // Pick the face with the largest area (best crop quality); confidence as tiebreaker
    const candidates = await this.prisma.face.findMany({
      where: { personId, ownerId, asset: { isDeleted: false }, confidence: { gte: 0.6 } },
      include: { asset: { select: { originalPath: true, thumbnailLargePath: true } } },
    });
    if (!candidates.length) throw new NotFoundException('No face found for this person');

    const face = candidates.sort((a, b) => {
      const area = (f: any) => {
        const bb = f.bbox as any;
        return (bb.x2 - bb.x1) * (bb.y2 - bb.y1);
      };
      const diff = area(b) - area(a);
      return diff !== 0 ? diff : b.confidence - a.confidence;
    })[0];

    const bbox = face.bbox as { x1: number; y1: number; x2: number; y2: number };

    // Determine the best source image for cropping.
    // Face detection ran on the large thumbnail (max 720×720), so bbox is in thumbnail space.
    // Try thumbnail first; if bbox overflows its dimensions, fall back to the original.
    let sourceBuffer: Buffer;
    let usedThumb = false;

    if (face.asset.thumbnailLargePath) {
      try {
        const buf = await streamToBuffer(await this.storage.getStream(face.asset.thumbnailLargePath));
        const meta = await (sharp as any)(buf).metadata();
        if (bbox.x2 <= (meta.width ?? 0) && bbox.y2 <= (meta.height ?? 0)) {
          sourceBuffer = buf;
          usedThumb = true;
        } else {
          // bbox is from original-space detection — download original and scale bbox
          sourceBuffer = await streamToBuffer(await this.storage.getStream(face.asset.originalPath));
        }
      } catch {
        sourceBuffer = await streamToBuffer(await this.storage.getStream(face.asset.originalPath));
      }
    } else {
      sourceBuffer = await streamToBuffer(await this.storage.getStream(face.asset.originalPath));
    }

    // Auto-rotate and get final dimensions
    const rotated = await (sharp as any)(sourceBuffer).rotate().toBuffer();
    const meta = await (sharp as any)(rotated).metadata();
    const imgW = meta.width as number;
    const imgH = meta.height as number;

    // Scale bbox if it came from original-space but we're using thumbnail
    // (This branch is for legacy faces detected before thumbnail-based re-detection)
    let { x1, y1, x2, y2 } = bbox;
    if (!usedThumb && (x1 > imgW || y1 > imgH)) {
      // bbox exceeds image bounds — skip, serve placeholder
      throw new NotFoundException('Bbox out of bounds');
    }
    // Clamp to image
    x1 = Math.max(0, Math.min(x1, imgW - 1));
    y1 = Math.max(0, Math.min(y1, imgH - 1));
    x2 = Math.max(x1 + 1, Math.min(x2, imgW));
    y2 = Math.max(y1 + 1, Math.min(y2, imgH));

    // Adaptive padding: smaller faces get less padding so the face fills the crop
    const faceW = x2 - x1;
    const faceH = y2 - y1;
    const faceSize = Math.min(faceW, faceH);
    const padFactor = faceSize >= 80 ? 0.5 : faceSize >= 40 ? 0.35 : 0.2;
    const padX = Math.round(faceW * padFactor);
    const padY = Math.round(faceH * padFactor);

    const left   = Math.max(0, x1 - padX);
    const top    = Math.max(0, y1 - padY);
    const width  = Math.min(imgW - left, faceW + 2 * padX);
    const height = Math.min(imgH - top,  faceH + 2 * padY);

    const cropBuffer = await (sharp as any)(rotated)
      .extract({ left, top, width, height })
      .resize(256, 256, { fit: 'cover', position: 'centre' })
      .webp({ quality: 85 })
      .toBuffer();

    // Cache in S3
    await this.storage.putBuffer(cacheKey, cropBuffer, 'image/webp');

    return cropBuffer;
  }

  /** Invalidate cached face crop (call when person's photos change). */
  async invalidateFaceCrop(personId: string): Promise<void> {
    await this.storage.deleteObject(`face-crops/${personId}.webp`);
  }
}
