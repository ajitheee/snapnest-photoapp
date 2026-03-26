import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { Asset, AssetType } from '@prisma/client';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const UPLOAD_DIR = process.env.UPLOAD_PATH || '/uploads';
const TRASH_RETENTION_DAYS = 30;

export interface PaginatedAssets {
  assets: Asset[];
  total: number;
  page: number;
  limit: number;
}

function detectAssetType(mimeType: string): AssetType {
  if (mimeType.startsWith('image/')) return AssetType.IMAGE;
  if (mimeType.startsWith('video/')) return AssetType.VIDEO;
  return AssetType.OTHER;
}

function computeChecksum(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  async uploadAsset(
    ownerId: string,
    file: Express.Multer.File,
    fileCreatedAt?: string,
  ): Promise<Asset> {
    const checksum = computeChecksum(file.path);

    const existing = await this.prisma.asset.findFirst({
      where: { checksum, ownerId },
    });
    if (existing) {
      fs.unlinkSync(file.path);
      throw new ConflictException('Asset already exists in your library');
    }

    const assetType = detectAssetType(file.mimetype);
    const createdAt = fileCreatedAt ? new Date(fileCreatedAt) : new Date();

    let asset: Asset;
    try {
      asset = await this.prisma.asset.create({
        data: {
          ownerId,
          originalPath: file.path,
          fileName: file.originalname,
          fileSizeBytes: BigInt(file.size),
          mimeType: file.mimetype,
          checksum,
          type: assetType,
          fileCreatedAt: createdAt,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        fs.unlinkSync(file.path);
        throw new ConflictException('Asset already exists in the library');
      }
      throw err;
    }

    await this.prisma.assetJobStatus.create({ data: { assetId: asset.id } });
    await this.queueService.enqueueAfterUpload(asset.id, assetType, file.path);

    return asset;
  }

  async findAll(ownerId: string, page = 1, limit = 50): Promise<PaginatedAssets> {
    const skip = (page - 1) * limit;
    const where = { ownerId, isDeleted: false, isArchived: false };
    const [assets, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({ where, orderBy: { fileCreatedAt: 'desc' }, skip, take: limit }),
      this.prisma.asset.count({ where }),
    ]);
    return { assets, total, page, limit };
  }

  async findOne(id: string, ownerId: string): Promise<Asset> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset || asset.isDeleted) throw new NotFoundException('Asset not found');
    if (asset.ownerId !== ownerId) throw new ForbiddenException('Access denied');
    return asset;
  }

  // Access deleted assets too (for trash operations)
  private async findAsset(id: string, ownerId: string): Promise<Asset> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.ownerId !== ownerId) throw new ForbiddenException('Access denied');
    return asset;
  }

  async toggleFavorite(id: string, ownerId: string): Promise<Asset> {
    const asset = await this.findOne(id, ownerId);
    return this.prisma.asset.update({
      where: { id },
      data: { isFavorite: !asset.isFavorite },
    });
  }

  async toggleArchive(id: string, ownerId: string): Promise<Asset> {
    const asset = await this.findOne(id, ownerId);
    return this.prisma.asset.update({
      where: { id },
      data: { isArchived: !asset.isArchived },
    });
  }

  async findFavorites(ownerId: string, page = 1, limit = 50): Promise<PaginatedAssets> {
    const skip = (page - 1) * limit;
    const where = { ownerId, isFavorite: true, isDeleted: false };
    const [assets, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({ where, orderBy: { fileCreatedAt: 'desc' }, skip, take: limit }),
      this.prisma.asset.count({ where }),
    ]);
    return { assets, total, page, limit };
  }

  async findArchived(ownerId: string, page = 1, limit = 50): Promise<PaginatedAssets> {
    const skip = (page - 1) * limit;
    const where = { ownerId, isArchived: true, isDeleted: false };
    const [assets, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({ where, orderBy: { fileCreatedAt: 'desc' }, skip, take: limit }),
      this.prisma.asset.count({ where }),
    ]);
    return { assets, total, page, limit };
  }

  async softDelete(id: string, ownerId: string): Promise<Asset> {
    await this.findOne(id, ownerId);
    return this.prisma.asset.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  }

  async findTrashed(ownerId: string, page = 1, limit = 50): Promise<PaginatedAssets> {
    const skip = (page - 1) * limit;
    const where = { ownerId, isDeleted: true };
    const [assets, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({ where, orderBy: { deletedAt: 'desc' }, skip, take: limit }),
      this.prisma.asset.count({ where }),
    ]);
    return { assets, total, page, limit };
  }

  async restoreFromTrash(id: string, ownerId: string): Promise<Asset> {
    const asset = await this.findAsset(id, ownerId);
    if (!asset.isDeleted) throw new BadRequestException('Asset is not in trash');
    return this.prisma.asset.update({
      where: { id },
      data: { isDeleted: false, deletedAt: null },
    });
  }

  async permanentDelete(id: string, ownerId: string): Promise<void> {
    const asset = await this.findAsset(id, ownerId);
    if (!asset.isDeleted) throw new BadRequestException('Move asset to trash first');

    // Delete files from disk
    const filesToRemove = [
      asset.originalPath,
      asset.thumbnailSmallPath,
      asset.thumbnailLargePath,
    ].filter(Boolean) as string[];

    for (const f of filesToRemove) {
      try { fs.unlinkSync(f); } catch {}
    }

    // Delete HLS directory if it exists
    const hlsDir = path.join(UPLOAD_DIR, 'hls', id);
    try { fs.rmSync(hlsDir, { recursive: true, force: true }); } catch {}

    await this.prisma.asset.delete({ where: { id } });
  }

  async purgeExpiredTrash(): Promise<number> {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const expired = await this.prisma.asset.findMany({
      where: { isDeleted: true, deletedAt: { lt: cutoff } },
      select: { id: true, ownerId: true },
    });
    for (const { id, ownerId } of expired) {
      await this.permanentDelete(id, ownerId);
    }
    return expired.length;
  }

  async findWithGps(ownerId: string): Promise<Asset[]> {
    return this.prisma.asset.findMany({
      where: {
        ownerId,
        isDeleted: false,
        isArchived: false,
        locationLat: { not: null },
        locationLng: { not: null },
      },
      orderBy: { fileCreatedAt: 'desc' },
    });
  }

  async getExploreSummary(ownerId: string) {
    const where = { ownerId, isDeleted: false, isArchived: false };

    // Counts by year-month
    const allAssets = await this.prisma.asset.findMany({
      where,
      select: {
        id: true,
        fileCreatedAt: true,
        locationCity: true,
        locationCountry: true,
        thumbnailSmallPath: true,
        mimeType: true,
        type: true,
        fileName: true,
      },
      orderBy: { fileCreatedAt: 'desc' },
    });

    // Group by month
    const monthMap = new Map<string, typeof allAssets>();
    for (const a of allAssets) {
      const d = new Date(a.fileCreatedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthMap.has(key)) monthMap.set(key, []);
      monthMap.get(key)!.push(a);
    }

    // Group by location
    const locationMap = new Map<string, typeof allAssets>();
    for (const a of allAssets) {
      if (!a.locationCity) continue;
      const key = [a.locationCity, a.locationCountry].filter(Boolean).join(', ');
      if (!locationMap.has(key)) locationMap.set(key, []);
      locationMap.get(key)!.push(a);
    }

    // Top tags
    const tagRows = await this.prisma.assetTag.groupBy({
      by: ['tag'],
      where: { asset: { ownerId, isDeleted: false, isArchived: false } },
      _count: { tag: true },
      orderBy: { _count: { tag: 'desc' } },
      take: 30,
    });

    const months = Array.from(monthMap.entries()).map(([key, assets]) => ({
      key,
      label: new Date(key + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      count: assets.length,
      cover: assets[0],
    }));

    const locations = Array.from(locationMap.entries()).map(([key, assets]) => ({
      key,
      count: assets.length,
      cover: assets[0],
    }));

    const tags = tagRows.map((r) => ({ tag: r.tag, count: r._count.tag }));

    return { months, locations, tags, total: allAssets.length };
  }

  async getJobStatus(id: string, ownerId: string) {
    await this.findOne(id, ownerId);
    return this.prisma.assetJobStatus.findUnique({ where: { assetId: id } });
  }

  async serveThumbnail(
    id: string,
    ownerId: string,
    size: 'small' | 'large' = 'small',
  ): Promise<{ filePath: string; mimeType: string }> {
    const asset = await this.findOne(id, ownerId);
    const thumbPath = size === 'large' ? asset.thumbnailLargePath : asset.thumbnailSmallPath;
    const filePath = thumbPath || asset.originalPath;
    const mimeType = thumbPath ? 'image/webp' : asset.mimeType;
    return { filePath, mimeType };
  }

  getHlsPath(assetId: string): string {
    return path.join(UPLOAD_DIR, 'hls', assetId);
  }
}
