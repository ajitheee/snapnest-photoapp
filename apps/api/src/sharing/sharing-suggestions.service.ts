import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SharingSuggestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSuggestions(ownerId: string) {
    const recentFaces = await this.prisma.face.findMany({
      where: {
        ownerId,
        person: { name: { not: '' } },
        asset: { isDeleted: false, fileCreatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      },
      include: {
        person: true,
        asset: { select: { id: true, fileName: true, fileCreatedAt: true, thumbnailSmallPath: true } },
      },
      orderBy: { asset: { fileCreatedAt: 'desc' } },
      take: 50,
    });

    const personAssets = new Map<string, { person: any; assets: any[] }>();
    for (const face of recentFaces) {
      if (!face.person) continue;
      const key = face.person.id;
      if (!personAssets.has(key)) personAssets.set(key, { person: face.person, assets: [] });
      const group = personAssets.get(key)!;
      if (!group.assets.find(a => a.id === face.asset.id)) {
        group.assets.push(face.asset);
      }
    }

    return Array.from(personAssets.values())
      .filter(g => g.assets.length >= 2)
      .map(g => ({
        personId: g.person.id,
        personName: g.person.name,
        assetCount: g.assets.length,
        previewAssets: g.assets.slice(0, 4),
        suggestion: `Share ${g.assets.length} recent photos with ${g.person.name}?`,
      }));
  }
}
