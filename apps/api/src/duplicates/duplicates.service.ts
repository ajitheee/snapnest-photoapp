import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DuplicatesService {
  constructor(private readonly prisma: PrismaService) {}

  async findDuplicates(ownerId: string) {
    const assets = await this.prisma.asset.findMany({
      where: { ownerId, isDeleted: false, perceptualHash: { not: null } },
      select: {
        id: true,
        perceptualHash: true,
        fileName: true,
        fileSizeBytes: true,
        fileCreatedAt: true,
        thumbnailSmallPath: true,
        width: true,
        height: true,
        mimeType: true,
        type: true,
      },
      orderBy: { fileCreatedAt: 'desc' },
    });

    const groups = new Map<string, typeof assets>();
    for (const asset of assets) {
      if (!asset.perceptualHash) continue;
      if (!groups.has(asset.perceptualHash)) groups.set(asset.perceptualHash, []);
      groups.get(asset.perceptualHash)!.push(asset);
    }

    return Array.from(groups.entries())
      .filter(([, items]) => items.length > 1)
      .map(([hash, items]) => ({
        hash,
        assets: items.map(a => ({ ...a, fileSizeBytes: a.fileSizeBytes.toString() })),
      }));
  }

  async mergeDuplicates(ownerId: string, keepId: string, removeIds: string[]): Promise<{ removed: number }> {
    const keep = await this.prisma.asset.findFirst({ where: { id: keepId, ownerId, isDeleted: false } });
    if (!keep) throw new NotFoundException('Keep asset not found');

    const toRemove = await this.prisma.asset.findMany({
      where: { id: { in: removeIds }, ownerId, isDeleted: false },
    });

    await this.prisma.asset.updateMany({
      where: { id: { in: toRemove.map(a => a.id) } },
      data: { isDeleted: true, deletedAt: new Date() },
    });

    return { removed: toRemove.length };
  }
}
