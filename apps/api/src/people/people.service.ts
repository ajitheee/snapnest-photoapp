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
        _count: { select: { faces: { where: { asset: { isDeleted: false } } } } },
      },
      orderBy: { name: 'asc' },
    });

    const filtered = people.filter((p) => p._count.faces > 0);

    // Resolve coverAssetId: use the cover face (coverFaceId) for accuracy.
    // Fall back to the highest-confidence face if cover isn't set.
    const coverFaceIds = filtered
      .map((p) => p.coverFaceId)
      .filter((id): id is string => !!id);

    const coverFaces = coverFaceIds.length
      ? await this.prisma.face.findMany({
          where: { id: { in: coverFaceIds }, asset: { isDeleted: false } },
          select: { id: true, assetId: true },
        })
      : [];
    const coverFaceMap = new Map(coverFaces.map((f) => [f.id, f.assetId]));

    // For people without a coverFaceId, find their best face
    const noCoverIds = filtered
      .filter((p) => !p.coverFaceId)
      .map((p) => p.id);
    const fallbackFaces = noCoverIds.length
      ? await this.prisma.face.findMany({
          where: { personId: { in: noCoverIds }, asset: { isDeleted: false } },
          select: { personId: true, assetId: true, confidence: true },
          orderBy: { confidence: 'desc' },
        })
      : [];
    const fallbackMap = new Map<string, string>();
    for (const f of fallbackFaces) {
      if (f.personId && !fallbackMap.has(f.personId)) {
        fallbackMap.set(f.personId, f.assetId);
      }
    }

    return filtered.map((p) => ({
      id: p.id,
      name: p.name,
      faceCount: p._count.faces,
      coverFaceId: p.coverFaceId,
      coverAssetId:
        (p.coverFaceId ? coverFaceMap.get(p.coverFaceId) : null) ??
        fallbackMap.get(p.id) ??
        null,
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
    const BATCH_SIZE = 500;
    const DIM = 512;
    const DBSCAN_EPS = 0.45;
    const CENTROID_MIN_SIMILARITY = 0.62;

    // 1. Load only unassigned faces (incremental — never wipe existing people)
    const unassigned = await this.prisma.face.findMany({
      where: { ownerId, personId: null, confidence: { gte: 0.65 } },
      select: { id: true, embedding: true },
    });

    if (unassigned.length === 0) {
      const total = await this.prisma.person.count({
        where: { ownerId, faces: { some: { asset: { isDeleted: false } } } },
      });
      return { created: 0, updated: 0, total };
    }

    // 2. Build centroids for existing people (average embedding per person)
    const existingPeople = await this.prisma.person.findMany({
      where: { ownerId },
      select: { id: true },
    });

    const centroids = new Map<string, Float64Array>();
    for (const person of existingPeople) {
      const personFaces = await this.prisma.face.findMany({
        where: { personId: person.id, ownerId, confidence: { gte: 0.65 } },
        select: { embedding: true },
        take: 20,
      });
      if (personFaces.length === 0) continue;
      const centroid = new Float64Array(DIM);
      for (const f of personFaces) {
        const emb = f.embedding as number[];
        for (let j = 0; j < DIM; j++) centroid[j] += emb[j] ?? 0;
      }
      for (let j = 0; j < DIM; j++) centroid[j] /= personFaces.length;
      centroids.set(person.id, centroid);
    }

    let created = 0;
    let updated = 0;

    // 3. Process unassigned faces in batches via ML clustering
    for (let offset = 0; offset < unassigned.length; offset += BATCH_SIZE) {
      const batch = unassigned.slice(offset, offset + BATCH_SIZE);
      const faceIds = batch.map((f) => f.id);

      const buf = Buffer.allocUnsafe(batch.length * DIM * 4);
      batch.forEach((f, i) => {
        const emb = f.embedding as number[];
        for (let j = 0; j < DIM; j++) {
          buf.writeFloatLE(emb[j] ?? 0, (i * DIM + j) * 4);
        }
      });

      let clusters: { face_id: string; cluster_id: number }[];
      try {
        const res = await axios.post(
          `${ML_URL}/cluster/faces/binary`,
          { face_ids: faceIds, embeddings_b64: buf.toString('base64'), dim: DIM, threshold: DBSCAN_EPS },
          { timeout: 120000 },
        );
        clusters = res.data.clusters;
      } catch (err) {
        // ML service unavailable — fall back to centroid-only assignment
        clusters = faceIds.map((id) => ({ face_id: id, cluster_id: -1 }));
      }

      // Group batch results by cluster_id
      const clusterMap = new Map<number, string[]>();
      const orphanFaceIds: string[] = [];
      for (const c of clusters) {
        if (c.cluster_id < 0) {
          orphanFaceIds.push(c.face_id);
          continue;
        }
        if (!clusterMap.has(c.cluster_id)) clusterMap.set(c.cluster_id, []);
        clusterMap.get(c.cluster_id)!.push(c.face_id);
      }

      // 4. For each new cluster, try to match to an existing person by centroid
      for (const [, clusterFaceIds] of clusterMap) {
        const clusterCentroid = this._computeCentroid(batch, clusterFaceIds, DIM);
        const matchedPersonId = this._findBestMatch(clusterCentroid, centroids, CENTROID_MIN_SIMILARITY);

        if (matchedPersonId) {
          await this.prisma.face.updateMany({
            where: { id: { in: clusterFaceIds } },
            data: { personId: matchedPersonId },
          });
          updated += clusterFaceIds.length;
          this._updateCentroid(centroids, matchedPersonId, clusterCentroid);
        } else {
          const person = await this.prisma.person.create({
            data: { ownerId, name: '' },
          });
          await this.prisma.face.updateMany({
            where: { id: { in: clusterFaceIds } },
            data: { personId: person.id },
          });
          centroids.set(person.id, clusterCentroid);
          created++;
          await this._setCoverFace(person.id, clusterFaceIds);
        }
      }

      // 5. Assign orphan faces (DBSCAN noise) to nearest existing person
      for (const faceId of orphanFaceIds) {
        const face = batch.find((f) => f.id === faceId);
        if (!face) continue;
        const emb = new Float64Array(face.embedding as number[]);
        const matchedPersonId = this._findBestMatch(emb, centroids, CENTROID_MIN_SIMILARITY);
        if (matchedPersonId) {
          await this.prisma.face.update({
            where: { id: faceId },
            data: { personId: matchedPersonId },
          });
          updated++;
        } else {
          const person = await this.prisma.person.create({
            data: { ownerId, name: '' },
          });
          await this.prisma.face.update({
            where: { id: faceId },
            data: { personId: person.id },
          });
          centroids.set(person.id, emb);
          created++;
          await this._setCoverFace(person.id, [faceId]);
        }
      }
    }

    // 6. Update cover faces for people that got new faces
    const peopleWithNewFaces = await this.prisma.person.findMany({
      where: { ownerId, coverFaceId: null, faces: { some: {} } },
      select: { id: true, faces: { select: { id: true }, take: 50 } },
    });
    for (const p of peopleWithNewFaces) {
      await this._setCoverFace(p.id, p.faces.map((f) => f.id));
    }

    // Clean up empty people (no faces left after deletions)
    await this.prisma.person.deleteMany({
      where: { ownerId, faces: { none: {} } },
    });

    const total = await this.prisma.person.count({
      where: { ownerId, faces: { some: { asset: { isDeleted: false } } } },
    });

    return { created, updated, total };
  }

  private _computeCentroid(
    batch: { id: string; embedding: any }[],
    faceIds: string[],
    dim: number,
  ): Float64Array {
    const centroid = new Float64Array(dim);
    let count = 0;
    for (const fid of faceIds) {
      const face = batch.find((f) => f.id === fid);
      if (!face) continue;
      const emb = face.embedding as number[];
      for (let j = 0; j < dim; j++) centroid[j] += emb[j] ?? 0;
      count++;
    }
    if (count > 0) for (let j = 0; j < dim; j++) centroid[j] /= count;
    return centroid;
  }

  private _findBestMatch(
    emb: Float64Array,
    centroids: Map<string, Float64Array>,
    minSimilarity: number,
  ): string | null {
    let bestId: string | null = null;
    let bestSim = -Infinity;
    for (const [personId, centroid] of centroids) {
      const sim = this._cosineSimilarity(emb, centroid);
      if (sim > bestSim) { bestSim = sim; bestId = personId; }
    }
    return bestSim >= minSimilarity ? bestId : null;
  }

  private _cosineSimilarity(a: Float64Array, b: Float64Array): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  private _updateCentroid(
    centroids: Map<string, Float64Array>,
    personId: string,
    newCentroid: Float64Array,
  ): void {
    const existing = centroids.get(personId);
    if (!existing) { centroids.set(personId, newCentroid); return; }
    const merged = new Float64Array(existing.length);
    for (let j = 0; j < existing.length; j++) merged[j] = (existing[j] + newCentroid[j]) / 2;
    centroids.set(personId, merged);
  }

  private async _setCoverFace(personId: string, faceIds: string[]): Promise<void> {
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
        where: { id: personId },
        data: { coverFaceId: bestFace.id },
      });
    }
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
      where: { personId, ownerId, asset: { isDeleted: false }, confidence: { gte: 0.5 } },
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
