import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { MetricsService } from '../metrics/metrics.service';
import { StorageService } from '../storage/storage.service';
import { Asset, AssetType } from '@prisma/client';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const UPLOAD_DIR = process.env.UPLOAD_PATH || '/uploads';
const TRASH_RETENTION_DAYS = 30;
const SESSIONS_DIR = path.join(UPLOAD_DIR, 'sessions');

export interface PaginatedAssets {
  assets: Asset[];
  total: number;
  page: number;
  limit: number;
}

const HEIC_EXTS = new Set(['.heic', '.heif', '.avif']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.3gp', '.wmv']);

function detectAssetType(mimeType: string, fileName?: string): AssetType {
  if (mimeType.startsWith('image/')) return AssetType.IMAGE;
  if (mimeType.startsWith('video/')) return AssetType.VIDEO;
  if (fileName) {
    const ext = path.extname(fileName).toLowerCase();
    if (HEIC_EXTS.has(ext) || IMAGE_EXTS.has(ext)) return AssetType.IMAGE;
    if (VIDEO_EXTS.has(ext)) return AssetType.VIDEO;
  }
  return AssetType.OTHER;
}

function detectMimeType(mimeType: string, fileName?: string): string {
  if (mimeType && mimeType !== 'application/octet-stream') return mimeType;
  if (fileName) {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.heic' || ext === '.heif') return 'image/heic';
    if (ext === '.avif') return 'image/avif';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.mp4') return 'video/mp4';
    if (ext === '.mov') return 'video/quicktime';
  }
  return mimeType;
}

function computeChecksum(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly metricsService: MetricsService,
    private readonly storage: StorageService,
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

    // Quota check
    const user = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { storageLimitBytes: true, storageUsedBytes: true },
    });
    if (user?.storageLimitBytes !== null && user?.storageLimitBytes !== undefined) {
      if ((user.storageUsedBytes ?? BigInt(0)) + BigInt(file.size) > user.storageLimitBytes) {
        fs.unlinkSync(file.path);
        throw new ForbiddenException('Storage quota exceeded');
      }
    }

    const resolvedMime = detectMimeType(file.mimetype, file.originalname);
    const assetType = detectAssetType(resolvedMime, file.originalname);
    const createdAt = fileCreatedAt ? new Date(fileCreatedAt) : new Date();

    // Upload original to S3; store the S3 key (no leading '/') in originalPath
    const s3Key = `originals/${path.basename(file.path)}`;
    try {
      await this.storage.putFile(file.path, s3Key, resolvedMime);
    } catch (err: any) {
      fs.unlinkSync(file.path);
      throw new Error(`S3 upload failed: ${err.message}`);
    }

    let asset: Asset;
    try {
      asset = await this.prisma.asset.create({
        data: {
          ownerId,
          originalPath: s3Key,   // S3 key — no leading '/'
          fileName: file.originalname,
          fileSizeBytes: BigInt(file.size),
          mimeType: resolvedMime,
          checksum,
          type: assetType,
          fileCreatedAt: createdAt,
        },
      });
    } catch (err: any) {
      await this.storage.deleteObject(s3Key);
      fs.unlinkSync(file.path);
      if (err?.code === 'P2002') {
        throw new ConflictException('Asset already exists in the library');
      }
      throw err;
    }

    await this.prisma.assetJobStatus.create({ data: { assetId: asset.id } });
    // Increment storage usage counter atomically
    await this.prisma.user.update({
      where: { id: ownerId },
      data: { storageUsedBytes: { increment: BigInt(file.size) } },
    });
    // Enqueue with the LOCAL temp path so thumbnail/transcode/ML processors can read the file
    await this.queueService.enqueueAfterUpload(asset.id, assetType, file.path);
    this.metricsService.incrementUpload(assetType);

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

  async findVideos(ownerId: string, page = 1, limit = 50, month?: string): Promise<PaginatedAssets> {
    const skip = (page - 1) * limit;
    const where: any = { ownerId, isDeleted: false, isArchived: false, type: 'VIDEO' };
    if (month) {
      // month format: "YYYY-MM"
      const [year, mon] = month.split('-').map(Number);
      if (year && mon) {
        where.fileCreatedAt = {
          gte: new Date(year, mon - 1, 1),
          lt:  new Date(year, mon, 1),
        };
      }
    }
    const [assets, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({ where, orderBy: { fileCreatedAt: 'desc' }, skip, take: limit }),
      this.prisma.asset.count({ where }),
    ]);
    return { assets, total, page, limit };
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

    // Delete from S3 (keys stored without leading '/') and local disk (paths start with '/')
    const paths = [
      asset.originalPath,
      asset.thumbnailSmallPath,
      asset.thumbnailLargePath,
    ].filter(Boolean) as string[];

    const s3Keys = paths.filter(p => this.storage.isS3Key(p));
    const localPaths = paths.filter(p => !this.storage.isS3Key(p));

    await this.storage.deleteObjects([...s3Keys, `hls/${id}/master.m3u8`]);
    // Also attempt to delete HLS segments — prefix-based delete via listing would be ideal
    // but for simplicity we remove known prefixes used by transcode processor
    for (const label of ['1080p', '720p', '360p']) {
      await this.storage.deleteObjects([
        `hls/${id}/${label}/index.m3u8`,
        // individual .ts segments are cleaned up by the bulk delete in purge
      ]);
    }

    for (const f of localPaths) {
      try { fs.unlinkSync(f); } catch {}
    }
    // Clean up any remaining local temp files
    const hlsDir = path.join(UPLOAD_DIR, 'hls', id);
    try { fs.rmSync(hlsDir, { recursive: true, force: true }); } catch {}

    await this.prisma.$transaction([
      this.prisma.asset.delete({ where: { id } }),
      this.prisma.user.update({
        where: { id: ownerId },
        data: { storageUsedBytes: { decrement: asset.fileSizeBytes } },
      }),
    ]);
  }

  async purgeExpiredTrash(): Promise<number> {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const expired = await this.prisma.asset.findMany({
      where: { isDeleted: true, deletedAt: { lt: cutoff } },
      select: { id: true, ownerId: true, fileSizeBytes: true, originalPath: true, thumbnailSmallPath: true, thumbnailLargePath: true },
    });
    for (const asset of expired) {
      const allPaths = [asset.originalPath, asset.thumbnailSmallPath, asset.thumbnailLargePath].filter(Boolean) as string[];
      const s3Keys = allPaths.filter(p => this.storage.isS3Key(p));
      const localPaths = allPaths.filter(p => !this.storage.isS3Key(p));
      await this.storage.deleteObjects(s3Keys);
      for (const f of localPaths) { try { fs.unlinkSync(f); } catch {} }
      try { fs.rmSync(path.join(UPLOAD_DIR, 'hls', asset.id), { recursive: true, force: true }); } catch {}
    }
    if (expired.length > 0) {
      // Bulk delete + decrement each user's storage in one transaction
      const byOwner = new Map<string, bigint>();
      for (const a of expired) byOwner.set(a.ownerId, (byOwner.get(a.ownerId) ?? BigInt(0)) + a.fileSizeBytes);
      await this.prisma.$transaction([
        this.prisma.asset.deleteMany({ where: { id: { in: expired.map(a => a.id) } } }),
        ...Array.from(byOwner.entries()).map(([ownerId, bytes]) =>
          this.prisma.user.update({ where: { id: ownerId }, data: { storageUsedBytes: { decrement: bytes } } })
        ),
      ]);
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
    const asset = await this.findAsset(id, ownerId);
    const thumbPath = size === 'large' ? asset.thumbnailLargePath : asset.thumbnailSmallPath;
    const filePath = thumbPath || asset.originalPath;
    const mimeType = thumbPath ? 'image/webp' : asset.mimeType;
    return { filePath, mimeType };
  }

  getHlsPath(assetId: string): string {
    return path.join(UPLOAD_DIR, 'hls', assetId);
  }

  async reprocessMissingThumbnails(ownerId: string): Promise<{ queued: number; fixed: number }> {
    // First fix mis-classified HEIC/HEIF assets stored as OTHER
    const heicAssets = await this.prisma.asset.findMany({
      where: { ownerId, isDeleted: false, type: 'OTHER', thumbnailSmallPath: null },
      select: { id: true, originalPath: true, fileName: true, mimeType: true },
    });
    let fixed = 0;
    for (const asset of heicAssets) {
      const ext = path.extname(asset.fileName).toLowerCase();
      if (HEIC_EXTS.has(ext) || IMAGE_EXTS.has(ext)) {
        const resolvedMime = detectMimeType(asset.mimeType, asset.fileName);
        await this.prisma.asset.update({
          where: { id: asset.id },
          data: { type: 'IMAGE', mimeType: resolvedMime },
        });
        fixed++;
      }
    }

    const assets = await this.prisma.asset.findMany({
      where: { ownerId, isDeleted: false, type: 'IMAGE', thumbnailSmallPath: null },
      select: { id: true, originalPath: true },
    });
    for (const asset of assets) {
      await this.queueService.enqueueAfterUpload(asset.id, 'IMAGE' as any, asset.originalPath);
    }
    return { queued: assets.length, fixed };
  }

  // ─── Phase 5: Incremental sync ─────────────────────────────────────────────

  /**
   * Bulk hash-check: given an array of SHA-256 checksums, return the subset
   * that do NOT yet exist in the user's library. The mobile client uses this
   * to skip files that have already been uploaded (deduplication).
   */
  async checkHashes(ownerId: string, checksums: string[]): Promise<string[]> {
    if (!checksums.length) return [];
    const existing = await this.prisma.asset.findMany({
      where: { ownerId, checksum: { in: checksums } },
      select: { checksum: true },
    });
    const existingSet = new Set(existing.map((a) => a.checksum));
    return checksums.filter((c) => !existingSet.has(c));
  }

  // ─── Phase 5: Resumable chunked uploads ────────────────────────────────────

  /** Create a new upload session and return its ID + chunk upload URL pattern. */
  async createUploadSession(
    userId: string,
    checksum: string,
    fileName: string,
    fileSize: string,
    mimeType: string,
    deviceAssetId?: string,
  ) {
    // If this checksum already exists for this user, return conflict immediately
    const existing = await this.prisma.asset.findFirst({
      where: { ownerId: userId, checksum },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Asset already exists in your library');
    }

    // Check for a pre-existing incomplete session with the same checksum
    const existingSession = await this.prisma.uploadSession.findFirst({
      where: { userId, checksum, completedAt: null },
    });
    if (existingSession) {
      return {
        sessionId: existingSession.id,
        bytesReceived: Number(existingSession.bytesReceived),
        resumed: true,
      };
    }

    const sessionId = crypto.randomUUID();
    const chunkDir = path.join(SESSIONS_DIR, sessionId);
    fs.mkdirSync(chunkDir, { recursive: true });

    const session = await this.prisma.uploadSession.create({
      data: {
        id: sessionId,
        userId,
        checksum,
        fileName,
        fileSize: BigInt(fileSize),
        mimeType,
        chunkDir,
      },
    });

    return { sessionId: session.id, bytesReceived: 0, resumed: false };
  }

  /**
   * Store a single chunk at the given byte offset.
   * Returns the updated bytesReceived count.
   */
  async uploadChunk(
    userId: string,
    sessionId: string,
    offset: number,
    chunkBuffer: Buffer,
  ): Promise<{ bytesReceived: number; complete: boolean }> {
    const session = await this.prisma.uploadSession.findFirst({
      where: { id: sessionId, userId, completedAt: null },
    });
    if (!session) throw new NotFoundException('Upload session not found');

    const chunkPath = path.join(session.chunkDir, `chunk_${String(offset).padStart(15, '0')}`);
    fs.writeFileSync(chunkPath, chunkBuffer);

    const newBytesReceived = BigInt(offset) + BigInt(chunkBuffer.length);
    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { bytesReceived: newBytesReceived },
    });

    const complete = newBytesReceived >= session.fileSize;
    return { bytesReceived: Number(newBytesReceived), complete };
  }

  /**
   * Assemble all chunks into the final file, run the normal upload pipeline,
   * then clean up the session.
   */
  async completeUploadSession(
    userId: string,
    sessionId: string,
    fileCreatedAt?: string,
    deviceAssetId?: string,
  ): Promise<Asset> {
    const session = await this.prisma.uploadSession.findFirst({
      where: { id: sessionId, userId, completedAt: null },
    });
    if (!session) throw new NotFoundException('Upload session not found');

    // Assemble chunks in offset order
    const chunkFiles = fs
      .readdirSync(session.chunkDir)
      .filter((f) => f.startsWith('chunk_'))
      .sort();

    if (!chunkFiles.length) {
      throw new BadRequestException('No chunks received yet');
    }

    const ext = path.extname(session.fileName);
    const finalPath = path.join(UPLOAD_DIR, `${crypto.randomUUID()}${ext}`);
    const writeStream = fs.createWriteStream(finalPath);

    for (const chunkFile of chunkFiles) {
      const chunkPath = path.join(session.chunkDir, chunkFile);
      writeStream.write(fs.readFileSync(chunkPath));
    }
    writeStream.end();

    // Verify checksum
    const actualChecksum = computeChecksum(finalPath);
    if (actualChecksum !== session.checksum) {
      fs.unlinkSync(finalPath);
      throw new BadRequestException('Checksum mismatch — upload is corrupt, please retry');
    }

    const resolvedMime = detectMimeType(session.mimeType, session.fileName);
    const assetType = detectAssetType(resolvedMime, session.fileName);
    const createdAt = fileCreatedAt ? new Date(fileCreatedAt) : new Date();

    // Upload assembled file to S3
    const s3Key = `originals/${path.basename(finalPath)}`;
    try {
      await this.storage.putFile(finalPath, s3Key, resolvedMime);
    } catch (err: any) {
      fs.unlinkSync(finalPath);
      throw new Error(`S3 upload failed: ${err.message}`);
    }

    let asset: Asset;
    try {
      asset = await this.prisma.asset.create({
        data: {
          ownerId: userId,
          originalPath: s3Key,   // S3 key
          fileName: session.fileName,
          fileSizeBytes: session.fileSize,
          mimeType: resolvedMime,
          checksum: session.checksum,
          type: assetType,
          fileCreatedAt: createdAt,
          deviceAssetId,
        },
      });
    } catch (err: any) {
      await this.storage.deleteObject(s3Key);
      fs.unlinkSync(finalPath);
      if (err?.code === 'P2002') {
        throw new ConflictException('Asset already exists in the library');
      }
      throw err;
    }

    await this.prisma.assetJobStatus.create({ data: { assetId: asset.id } });
    // Enqueue with local path so processors can read the file
    await this.queueService.enqueueAfterUpload(asset.id, assetType, finalPath);

    // Mark session complete + clean up chunks
    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { completedAt: new Date() },
    });
    try { fs.rmSync(session.chunkDir, { recursive: true, force: true }); } catch {}

    return asset;
  }

  // ─── Phase 5: Live Photo / Motion Photo support ────────────────────────────

  /**
   * Attach a video companion to an existing image asset, marking it as a
   * Live Photo. Called after the image is already uploaded.
   * Accepts the raw video buffer and the original video file name.
   */
  async attachLivePhotoVideo(
    assetId: string,
    ownerId: string,
    videoFile: Express.Multer.File,
  ): Promise<Asset> {
    const asset = await this.findOne(assetId, ownerId);

    if (asset.type !== AssetType.IMAGE) {
      throw new BadRequestException('Live photo video can only be attached to image assets');
    }

    const s3Key = `originals/${path.basename(videoFile.path)}`;
    await this.storage.putFile(videoFile.path, s3Key, videoFile.mimetype || 'video/quicktime');

    return this.prisma.asset.update({
      where: { id: assetId },
      data: {
        isLivePhoto: true,
        livePhotoVideoPath: s3Key,
      },
    });
  }
}
