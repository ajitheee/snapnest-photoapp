import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SmartAlbumsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSmartAlbums(ownerId: string) {
    const [locationAlbums, monthAlbums, tagAlbums, peopleAlbums, videoAlbums] = await Promise.all([
      this.getLocationAlbums(ownerId),
      this.getMonthAlbums(ownerId),
      this.getTagAlbums(ownerId),
      this.getPeopleAlbums(ownerId),
      this.getVideoAlbums(ownerId),
    ]);

    return {
      people: peopleAlbums,
      locations: locationAlbums,
      months: monthAlbums,
      tags: tagAlbums,
      videos: videoAlbums,
    };
  }

  private async getVideoAlbums(ownerId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        TO_CHAR("fileCreatedAt", 'YYYY-MM') as month,
        TO_CHAR("fileCreatedAt", 'Month YYYY') as label,
        COUNT(*) as count,
        MIN(id) as cover_id
      FROM assets
      WHERE "ownerId" = ${ownerId}
        AND "isDeleted" = false
        AND "isArchived" = false
        AND "type" = 'VIDEO'
      GROUP BY TO_CHAR("fileCreatedAt", 'YYYY-MM'), TO_CHAR("fileCreatedAt", 'Month YYYY')
      ORDER BY month DESC
      LIMIT 24
    `;

    return rows.map((r) => ({
      id: `video:${r.month}`,
      name: r.label.trim(),
      type: 'VIDEO',
      assetCount: Number(r.count),
      coverAssetId: r.cover_id,
      criteria: { month: r.month, type: 'VIDEO' },
    }));
  }

  private async getPeopleAlbums(ownerId: string) {
    const people = await this.prisma.person.findMany({
      where: { ownerId },
      include: {
        _count: { select: { faces: { where: { asset: { isDeleted: false } } } } },
        faces: {
          take: 1,
          where: { asset: { isDeleted: false } },
          orderBy: { confidence: 'desc' },
          include: { asset: { select: { id: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    return people
      .filter((p) => p._count.faces > 0)   // hide people whose only photos are deleted
      .map((p) => ({
        id: p.id,
        name: p.name,
        type: 'PERSON',
        assetCount: p._count.faces,
        coverAssetId: p.faces[0]?.asset?.id ?? null,
        criteria: { personId: p.id },
      }));
  }

  private async getLocationAlbums(ownerId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        "locationCity" as city,
        "locationState" as state,
        "locationCountry" as country,
        COUNT(*) as count,
        MIN(id) as cover_id
      FROM assets
      WHERE "ownerId" = ${ownerId}
        AND "isDeleted" = false
        AND "isArchived" = false
        AND "locationCity" IS NOT NULL
      GROUP BY "locationCity", "locationState", "locationCountry"
      ORDER BY count DESC
      LIMIT 20
    `;

    return rows.map((r) => {
      const parts = [r.city, r.state, r.country].filter(Boolean);
      const key = parts.join(', ');
      return {
        id: `loc:${key}`,
        name: key,
        type: 'LOCATION',
        assetCount: Number(r.count),
        coverAssetId: r.cover_id,
        criteria: { location: key },
      };
    });
  }

  private async getMonthAlbums(ownerId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        TO_CHAR("fileCreatedAt", 'YYYY-MM') as month,
        TO_CHAR("fileCreatedAt", 'Month YYYY') as label,
        COUNT(*) as count,
        MIN(id) as cover_id
      FROM assets
      WHERE "ownerId" = ${ownerId}
        AND "isDeleted" = false
        AND "isArchived" = false
      GROUP BY TO_CHAR("fileCreatedAt", 'YYYY-MM'), TO_CHAR("fileCreatedAt", 'Month YYYY')
      ORDER BY month DESC
      LIMIT 24
    `;

    return rows.map((r) => ({
      id: `month:${r.month}`,
      name: r.label.trim(),
      type: 'DATE_RANGE',
      assetCount: Number(r.count),
      coverAssetId: r.cover_id,
      criteria: { month: r.month },
    }));
  }

  private async getTagAlbums(ownerId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        t.tag,
        COUNT(DISTINCT t."assetId") as count,
        MIN(t."assetId") as cover_id
      FROM asset_tags t
      JOIN assets a ON a.id = t."assetId"
      WHERE a."ownerId" = ${ownerId}
        AND a."isDeleted" = false
        AND a."isArchived" = false
      GROUP BY t.tag
      ORDER BY count DESC
      LIMIT 20
    `;

    return rows.map((r) => ({
      id: `tag:${r.tag}`,
      name: r.tag,
      type: 'TAG',
      assetCount: Number(r.count),
      coverAssetId: r.cover_id,
      criteria: { tag: r.tag },
    }));
  }
}
