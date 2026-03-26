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
    limit = 30,
  ) {
    if (!query?.trim()) throw new BadRequestException('Query is required');

    if (mode === 'semantic' || mode === 'auto') {
      try {
        return await this.semanticSearch(ownerId, query, limit);
      } catch {
        if (mode === 'semantic') throw new BadRequestException('Semantic search unavailable');
        // fall through to text search
      }
    }

    return this.textSearch(ownerId, query, page, limit);
  }

  private async textSearch(ownerId: string, query: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where = {
      ownerId,
      isDeleted: false,
      OR: [
        { fileName: { contains: query, mode: 'insensitive' as const } },
        { locationCity: { contains: query, mode: 'insensitive' as const } },
        { locationState: { contains: query, mode: 'insensitive' as const } },
        { locationCountry: { contains: query, mode: 'insensitive' as const } },
        { tags: { some: { tag: { contains: query, mode: 'insensitive' as const } } } },
      ],
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
      LIMIT ${limit}
    `;

    return {
      mode: 'semantic',
      assets: rows,
      total: rows.length,
      page: 1,
      limit,
    };
  }
}
