import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('thumbnail') private readonly thumbnailQueue: Queue,
    @InjectQueue('metadata')  private readonly metadataQueue: Queue,
    @InjectQueue('transcode') private readonly transcodeQueue: Queue,
    @InjectQueue('ml')        private readonly mlQueue: Queue,
  ) {}

  async getUsers(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          isAdmin: true,
          storageLimitBytes: true,
          storageUsedBytes: true,
          createdAt: true,
          _count: { select: { assets: true } },
        },
      }),
      this.prisma.user.count(),
    ]);
    return {
      users: users.map(u => ({
        ...u,
        storageLimitBytes: u.storageLimitBytes?.toString() ?? null,
        storageUsedBytes: u.storageUsedBytes.toString(),
      })),
      total,
      page,
      limit,
    };
  }

  async updateUser(id: string, patch: { name?: string; isAdmin?: boolean; storageLimitBytes?: string | null }) {
    const data: any = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.isAdmin !== undefined) data.isAdmin = patch.isAdmin;
    if (patch.storageLimitBytes !== undefined) {
      data.storageLimitBytes = patch.storageLimitBytes === null ? null : BigInt(patch.storageLimitBytes);
    }
    const user = await this.prisma.user.update({ where: { id }, data });
    return {
      ...user,
      passwordHash: undefined,
      storageLimitBytes: user.storageLimitBytes?.toString() ?? null,
      storageUsedBytes: user.storageUsedBytes.toString(),
    };
  }

  async deleteUser(id: string) {
    // Fetch all asset file paths before deleting so we can clean up disk
    const assets = await this.prisma.asset.findMany({
      where: { ownerId: id },
      select: { id: true, originalPath: true, thumbnailSmallPath: true, thumbnailLargePath: true },
    });

    // Delete assets first (FK has no cascade), then the user (albums/shareLinks/etc. have cascade)
    await this.prisma.$transaction([
      this.prisma.asset.deleteMany({ where: { ownerId: id } }),
      this.prisma.user.delete({ where: { id } }),
    ]);

    // Best-effort: remove files from disk after the DB transaction succeeds
    for (const asset of assets) {
      for (const p of [asset.originalPath, asset.thumbnailSmallPath, asset.thumbnailLargePath]) {
        if (p) fs.unlink(p, (err) => { if (err && err.code !== 'ENOENT') this.logger.warn(`Failed to delete file ${p}: ${err.message}`); });
      }
    }
  }

  /** Queue face detection for every IMAGE asset that hasn't been processed yet.
   *  Uses the large thumbnail (local filesystem path) so HEIC/RAW formats work. */
  async requeueMissingFaceDetection(): Promise<{ queued: number }> {
    const THUMBNAIL_DIR = process.env.THUMBNAIL_PATH || '/thumbnails';

    const assets = await this.prisma.asset.findMany({
      where: {
        isDeleted: false,
        type: 'IMAGE',
        jobStatus: { faceDetectedAt: null },
      },
      select: { id: true, thumbnailLargePath: true, originalPath: true },
    });

    let queued = 0;
    for (const asset of assets) {
      // Prefer large thumbnail (avoids HEIC format issues in ML service)
      let imagePath: string | null = null;
      if (asset.thumbnailLargePath) {
        const localThumb = `${THUMBNAIL_DIR}/${asset.thumbnailLargePath.replace('thumbnails/', '')}`;
        if (fs.existsSync(localThumb)) {
          imagePath = localThumb;
        }
      }
      // Fall back to local original if still on disk
      if (!imagePath && asset.originalPath) {
        const UPLOAD_DIR = process.env.UPLOAD_PATH || '/uploads';
        const filename = asset.originalPath.replace('originals/', '');
        const localOrig = `${UPLOAD_DIR}/${filename}`;
        if (fs.existsSync(localOrig)) imagePath = localOrig;
      }
      if (!imagePath) continue;

      await this.mlQueue.add('face-detect', { assetId: asset.id, imagePath }, { attempts: 2 });
      queued++;
    }
    this.logger.log(`Queued face detection for ${queued} assets`);
    return { queued };
  }

  async getStats() {
    const [userCount, assetCount, storageResult] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.asset.count({ where: { isDeleted: false } }),
      this.prisma.asset.aggregate({ _sum: { fileSizeBytes: true }, where: { isDeleted: false } }),
    ]);

    const [thumbCounts, metaCounts, transcodeCounts, mlCounts] = await Promise.all([
      this.thumbnailQueue.getJobCounts(),
      this.metadataQueue.getJobCounts(),
      this.transcodeQueue.getJobCounts(),
      this.mlQueue.getJobCounts(),
    ]);

    return {
      users: userCount,
      assets: assetCount,
      storageBytesTotal: storageResult._sum.fileSizeBytes?.toString() ?? '0',
      queues: {
        thumbnail: thumbCounts,
        metadata: metaCounts,
        transcode: transcodeCounts,
        ml: mlCounts,
      },
    };
  }
}
