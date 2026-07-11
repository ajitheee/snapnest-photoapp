import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

const ML_URL = process.env.ML_SERVICE_URL || 'http://ml:3003';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    ownerId: string,
    query: string,
    mode: 'text' | 'semantic' | 'auto' = 'auto',
    page = 1,
    limit = 50,
    month?: string,
    location?: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    // Month-based date filter (YYYY-MM format) — bypass text/semantic search
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      return this.monthSearch(ownerId, month, page, limit);
    }

    // Explicit date-range filter from the mobile date picker — bypass text/semantic
    if (dateFrom || dateTo) {
      return this.dateRangeSearch(ownerId, page, limit, dateFrom, dateTo);
    }

    // Location filter from explore cards (e.g. "Santa Clarita, US") — bypass text/semantic
    if (location?.trim()) {
      return this.locationSearch(ownerId, location.trim(), page, limit);
    }

    if (!query?.trim()) throw new BadRequestException('Query is required');

    if (mode === 'semantic' || mode === 'auto') {
      try {
        const result = await this.semanticSearch(ownerId, query, limit);
        if (mode === 'semantic' || result.assets.length > 0) return result;
        // In auto mode, fall through to text search if semantic returns no results
      } catch {
        if (mode === 'semantic') throw new BadRequestException('Semantic search unavailable');
        // fall through to text search
      }
    }

    return this.textSearch(ownerId, query, page, limit);
  }

  private async dateRangeSearch(
    ownerId: string,
    page: number,
    limit: number,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = { ownerId, isDeleted: false, isArchived: false };
    if (dateFrom || dateTo) {
      where.fileCreatedAt = {};
      if (dateFrom) where.fileCreatedAt.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setUTCHours(23, 59, 59, 999);
        where.fileCreatedAt.lte = end;
      }
    }

    const [assets, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({ where, orderBy: { fileCreatedAt: 'desc' }, skip, take: limit }),
      this.prisma.asset.count({ where }),
    ]);

    return {
      mode: 'date_range',
      assets: assets.map((a) => ({ ...a, fileSizeBytes: a.fileSizeBytes.toString() })),
      total,
      page,
      limit,
    };
  }

  private async monthSearch(ownerId: string, month: string, page: number, limit: number) {
    const [year, mon] = month.split('-').map(Number);
    const start = new Date(year, mon - 1, 1);
    const end = new Date(year, mon, 1); // exclusive upper bound
    const skip = (page - 1) * limit;

    const where = {
      ownerId,
      isDeleted: false,
      isArchived: false,
      fileCreatedAt: { gte: start, lt: end },
    };

    const [assets, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({ where, orderBy: { fileCreatedAt: 'desc' }, skip, take: limit }),
      this.prisma.asset.count({ where }),
    ]);

    return {
      mode: 'month',
      assets: assets.map((a) => ({ ...a, fileSizeBytes: a.fileSizeBytes.toString() })),
      total,
      page,
      limit,
    };
  }

  private async locationSearch(ownerId: string, location: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    // "Santa Clarita, US" → city="Santa Clarita", country="US"
    const parts = location.split(',').map(p => p.trim()).filter(Boolean);
    const city = parts[0] ?? '';
    const country = parts[parts.length - 1] ?? '';

    const orClauses: any[] = [
      { locationCity: { contains: location, mode: 'insensitive' as const } },
    ];
    if (parts.length >= 2) {
      // Match city AND country simultaneously for precision
      orClauses.push({
        AND: [
          { locationCity: { contains: city, mode: 'insensitive' as const } },
          { locationCountry: { contains: country, mode: 'insensitive' as const } },
        ],
      });
    }
    // Fallback: match city alone
    if (city) orClauses.push({ locationCity: { contains: city, mode: 'insensitive' as const } });

    const where = { ownerId, isDeleted: false, OR: orClauses };

    const [assets, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({ where, orderBy: { fileCreatedAt: 'desc' }, skip, take: limit }),
      this.prisma.asset.count({ where }),
    ]);

    return {
      mode: 'location',
      assets: assets.map((a) => ({ ...a, fileSizeBytes: a.fileSizeBytes.toString() })),
      total,
      page,
      limit,
    };
  }

  private async textSearch(ownerId: string, query: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const q = query.trim();

    // Build OR clauses — always include whole-query matches
    const orClauses: any[] = [
      { fileName: { contains: q, mode: 'insensitive' as const } },
      { locationCity: { contains: q, mode: 'insensitive' as const } },
      { locationState: { contains: q, mode: 'insensitive' as const } },
      { locationCountry: { contains: q, mode: 'insensitive' as const } },
      { tags: { some: { tag: { contains: q, mode: 'insensitive' as const } } } },
      { caption: { contains: q, mode: 'insensitive' as const } },
      { ocrText: { contains: q, mode: 'insensitive' as const } },
    ];

    // Split multi-word queries so each word is matched against tags independently
    const words = q.split(/\s+/).filter(w => w.length >= 3);
    if (words.length > 1) {
      for (const word of words) {
        orClauses.push(
          { tags: { some: { tag: { contains: word, mode: 'insensitive' as const } } } },
          { fileName: { contains: word, mode: 'insensitive' as const } },
          { locationCity: { contains: word, mode: 'insensitive' as const } },
        );
      }
    }

    // For "City, Country" style queries (from explore location cards), also try
    // matching each comma-separated part against the individual location fields.
    if (q.includes(',')) {
      const parts = q.split(',').map(p => p.trim()).filter(Boolean);
      for (const part of parts) {
        orClauses.push(
          { locationCity: { contains: part, mode: 'insensitive' as const } },
          { locationState: { contains: part, mode: 'insensitive' as const } },
          { locationCountry: { contains: part, mode: 'insensitive' as const } },
        );
      }
      // Additionally try AND match: city matches first part AND country matches second
      if (parts.length >= 2) {
        orClauses.push({
          AND: [
            { locationCity: { contains: parts[0], mode: 'insensitive' as const } },
            { locationCountry: { contains: parts[parts.length - 1], mode: 'insensitive' as const } },
          ],
        });
      }
    }

    const where = {
      ownerId,
      isDeleted: false,
      OR: orClauses,
    };

    const [assets, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({ where, orderBy: { fileCreatedAt: 'desc' }, skip, take: limit }),
      this.prisma.asset.count({ where }),
    ]);

    return {
      mode: 'text',
      assets: assets.map((a) => ({ ...a, fileSizeBytes: a.fileSizeBytes.toString() })),
      total,
      page,
      limit,
    };
  }

  private async semanticSearch(ownerId: string, query: string, limit: number) {
    const res = await axios.post(`${ML_URL}/embed/text`, { text: query }, { timeout: 15000 });
    const embedding: number[] = res.data.embedding;

    if (!embedding || embedding.length !== 512) {
      throw new Error('Invalid embedding from ML service');
    }

    const vec = `[${embedding.join(',')}]`;
    const MIN_SIMILARITY = 0.18;
    const fetchLimit = limit * 2;

    const rows: any[] = await this.prisma.$queryRaw`
      SELECT
        id, "ownerId", "fileName", "mimeType", "type",
        "thumbnailSmallPath", "thumbnailLargePath",
        "fileCreatedAt", "fileSizeBytes"::text AS "fileSizeBytes",
        "isFavorite", "isArchived", "locationCity", "locationCountry",
        1 - ("clipEmbedding" <=> ${vec}::vector) AS similarity
      FROM assets
      WHERE "ownerId" = ${ownerId}
        AND "isDeleted" = false
        AND "clipEmbedding" IS NOT NULL
      ORDER BY "clipEmbedding" <=> ${vec}::vector
      LIMIT ${fetchLimit}
    `;

    const filtered = rows
      .filter((r) => r.similarity >= MIN_SIMILARITY)
      .slice(0, limit);

    return {
      mode: 'semantic',
      assets: filtered,
      total: filtered.length,
      page: 1,
      limit,
    };
  }
}
