import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SmartAlbumsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSmartAlbums(ownerId: string) {
    const [locationAlbums, monthAlbums, tagAlbums, peopleAlbums, videos, livePhotos] = await Promise.all([
      this.getLocationAlbums(ownerId),
      this.getMonthAlbums(ownerId),
      this.getTagAlbums(ownerId),
      this.getPeopleAlbums(ownerId),
      this.getVideos(ownerId),
      this.getLivePhotos(ownerId),
    ]);

    return {
      people: peopleAlbums,
      locations: locationAlbums,
      months: monthAlbums,
      tags: tagAlbums,
      videos,
      livePhotos,
    };
  }

  private async getVideos(ownerId: string) {
    const assets = await this.prisma.asset.findMany({
      where: { ownerId, isDeleted: false, isArchived: false, type: 'VIDEO' },
      orderBy: { fileCreatedAt: 'desc' },
    });
    return assets.map(a => ({ ...a, fileSizeBytes: a.fileSizeBytes.toString() }));
  }

  private async getLivePhotos(ownerId: string) {
    const assets = await this.prisma.asset.findMany({
      where: { ownerId, isDeleted: false, isArchived: false, isLivePhoto: true },
      orderBy: { fileCreatedAt: 'desc' },
    });
    return assets.map(a => ({ ...a, fileSizeBytes: a.fileSizeBytes.toString() }));
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

  async getAlbumExplore(ownerId: string, userEmail: string, albumService: any) {
    const [
      smart, myAlbums, sharedAlbums,
      recentDays, featured, mediaTypes, utilities,
    ] = await Promise.all([
      this.getSmartAlbums(ownerId),
      albumService.findAll(ownerId),
      albumService.findSharedWithMe(userEmail).catch(() => []),
      this.getRecentDays(ownerId),
      this.getFeatured(ownerId),
      this.getMediaTypeCounts(ownerId),
      this.getUtilityCounts(ownerId),
    ]);

    return {
      myAlbums,
      sharedAlbums,
      people: smart.people,
      places: smart.locations,
      months: smart.months,
      tags: smart.tags,
      recentDays,
      featured,
      mediaTypes,
      utilities,
    };
  }

  private async getRecentDays(ownerId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        DATE("fileCreatedAt") as day,
        COUNT(*) as count,
        MIN(id) as cover_id
      FROM assets
      WHERE "ownerId" = ${ownerId}
        AND "isDeleted" = false
        AND "isArchived" = false
        AND "fileCreatedAt" >= NOW() - INTERVAL '90 days'
      GROUP BY DATE("fileCreatedAt")
      ORDER BY day DESC
      LIMIT 14
    `;
    return rows.map(r => ({
      date: r.day instanceof Date ? r.day.toISOString().split('T')[0] : String(r.day),
      count: Number(r.count),
      coverAssetId: r.cover_id,
    }));
  }

  private async getFeatured(ownerId: string) {
    const assets = await this.prisma.asset.findMany({
      where: { ownerId, isDeleted: false, isArchived: false, isFavorite: true },
      orderBy: { fileCreatedAt: 'desc' },
      take: 20,
    });
    return assets.map(a => ({ ...a, fileSizeBytes: a.fileSizeBytes.toString() }));
  }

  private async getMediaTypeCounts(ownerId: string) {
    const [videos, livePhotos, selfies, screenshots, panoramas] = await Promise.all([
      this.prisma.asset.count({ where: { ownerId, isDeleted: false, type: 'VIDEO' } }),
      this.prisma.asset.count({ where: { ownerId, isDeleted: false, isLivePhoto: true } }),
      this.prisma.$queryRaw<any[]>`
        SELECT COUNT(*) as count, MIN(id) as cover_id FROM assets
        WHERE "ownerId" = ${ownerId} AND "isDeleted" = false AND "type" = 'IMAGE'
          AND ("exifData"::text LIKE '%front%' OR "exifData"::text LIKE '%TrueDepth%'
               OR "exifData"::text LIKE '%Front%')
      `.then(r => r[0]),
      this.prisma.$queryRaw<any[]>`
        SELECT COUNT(*) as count, MIN(id) as cover_id FROM assets
        WHERE "ownerId" = ${ownerId} AND "isDeleted" = false AND "type" = 'IMAGE'
          AND ("fileName" LIKE 'Screenshot%' OR "fileName" LIKE 'screenshot%'
               OR "fileName" LIKE '%Screenshot%')
      `.then(r => r[0]),
      this.prisma.$queryRaw<any[]>`
        SELECT COUNT(*) as count, MIN(id) as cover_id FROM assets
        WHERE "ownerId" = ${ownerId} AND "isDeleted" = false AND "type" = 'IMAGE'
          AND width IS NOT NULL AND height IS NOT NULL
          AND CAST(width AS FLOAT) / GREATEST(height, 1) > 2.5
      `.then(r => r[0]),
    ]);

    const videoCover = await this.prisma.asset.findFirst({
      where: { ownerId, isDeleted: false, type: 'VIDEO' },
      orderBy: { fileCreatedAt: 'desc' },
      select: { id: true },
    });
    const liveCover = await this.prisma.asset.findFirst({
      where: { ownerId, isDeleted: false, isLivePhoto: true },
      orderBy: { fileCreatedAt: 'desc' },
      select: { id: true },
    });

    return {
      videos: { count: videos, coverAssetId: videoCover?.id ?? null },
      livePhotos: { count: livePhotos, coverAssetId: liveCover?.id ?? null },
      selfies: { count: Number(selfies?.count ?? 0), coverAssetId: selfies?.cover_id ?? null },
      screenshots: { count: Number(screenshots?.count ?? 0), coverAssetId: screenshots?.cover_id ?? null },
      panoramas: { count: Number(panoramas?.count ?? 0), coverAssetId: panoramas?.cover_id ?? null },
    };
  }

  private async getUtilityCounts(ownerId: string) {
    const [archived, trashed, favorites, total] = await Promise.all([
      this.prisma.asset.count({ where: { ownerId, isArchived: true, isDeleted: false } }),
      this.prisma.asset.count({ where: { ownerId, isDeleted: true } }),
      this.prisma.asset.count({ where: { ownerId, isFavorite: true, isDeleted: false } }),
      this.prisma.asset.count({ where: { ownerId, isDeleted: false } }),
    ]);
    return { archived, trashed, favorites, total };
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
