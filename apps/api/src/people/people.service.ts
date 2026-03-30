import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

const ML_URL = process.env.ML_SERVICE_URL || 'http://ml:3003';

@Injectable()
export class PeopleService {
  constructor(private readonly prisma: PrismaService) {}

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

    return people.map((p) => ({
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
    // Unlink faces before deleting
    await this.prisma.face.updateMany({
      where: { personId, ownerId },
      data: { personId: null },
    });
    await this.prisma.person.delete({ where: { id: personId } });
  }

  async mergePeople(ownerId: string, sourceId: string, targetId: string) {
    await this.findOne(ownerId, sourceId);
    await this.findOne(ownerId, targetId);

    await this.prisma.face.updateMany({
      where: { personId: sourceId, ownerId },
      data: { personId: targetId },
    });
    await this.prisma.person.delete({ where: { id: sourceId } });
    return this.prisma.person.findFirst({ where: { id: targetId } });
  }

  async clusterFaces(ownerId: string): Promise<{ created: number; updated: number; total: number }> {
    // Wipe all auto-generated (unnamed / "Person N") people — preserve user-renamed ones
    const autoPeople = await this.prisma.person.findMany({
      where: { ownerId, name: { startsWith: 'Person ' } },
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

    // Load all faces with sufficient confidence (exclude very low-quality detections)
    const faces = await this.prisma.face.findMany({
      where: { ownerId, confidence: { gte: 0.4 } },
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
      { faces: payload, threshold: 0.6 },
      { timeout: 180000 },
    );

    const clusters: { face_id: string; cluster_id: number }[] = res.data.clusters;

    // Group by cluster_id, skip noise (-1)
    const clusterMap = new Map<number, string[]>();
    for (const c of clusters) {
      if (c.cluster_id < 0) continue;
      if (!clusterMap.has(c.cluster_id)) clusterMap.set(c.cluster_id, []);
      clusterMap.get(c.cluster_id)!.push(c.face_id);
    }

    // Skip singleton clusters that have no real signal (single isolated face per photo)
    // Keep only clusters with ≥2 faces OR high-confidence single face
    const meaningfulClusters = [...clusterMap.entries()].filter(
      ([, faceIds]) => faceIds.length >= 2,
    );

    let created = 0;

    for (const [, faceIds] of meaningfulClusters) {
      const person = await this.prisma.person.create({
        data: { ownerId, name: `Person ${created + 1}` },
      });

      await this.prisma.face.updateMany({
        where: { id: { in: faceIds } },
        data: { personId: person.id },
      });

      // Cover = highest confidence face
      const bestFace = await this.prisma.face.findFirst({
        where: { id: { in: faceIds } },
        orderBy: { confidence: 'desc' },
      });
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
}
