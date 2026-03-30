import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from './queue.service';
import { StorageService } from '../storage/storage.service';

const execFileAsync = promisify(execFile);

// Sharp's bundled libvips does not include the HEVC decoder needed for HEIC/HEIF.
// Use heif-convert (from libheif-tools, which links against libde265) to convert
// HEIC/HEIF to a temporary JPEG, then let sharp process the JPEG.
const HEIC_EXTS = new Set(['.heic', '.heif']);

async function toProcessablePath(filePath: string): Promise<{ path: string; temp: boolean }> {
  const ext = path.extname(filePath).toLowerCase();
  if (HEIC_EXTS.has(ext)) {
    const tmpPath = filePath + '.heic_tmp.jpg';
    await execFileAsync('heif-convert', [filePath, tmpPath]);
    return { path: tmpPath, temp: true };
  }
  return { path: filePath, temp: false };
}

const THUMBNAIL_DIR = process.env.THUMBNAIL_PATH || '/thumbnails';

@Processor('thumbnail')
export class ThumbnailProcessor extends WorkerHost {
  private readonly logger = new Logger(ThumbnailProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<{ assetId: string; filePath: string; assetType: string }>) {
    const { assetId, assetType } = job.data;
    let { filePath } = job.data;
    this.logger.log(`Generating thumbnails for asset ${assetId}`);

    // If the job carries an S3 key (reprocess case), download to a local temp file first
    let tempDownload = false;
    if (this.storage.isS3Key(filePath)) {
      const ext = path.extname(filePath) || '.bin';
      const tmpPath = path.join(THUMBNAIL_DIR, `tmp_${assetId}${ext}`);
      await this.storage.downloadToFile(filePath, tmpPath);
      filePath = tmpPath;
      tempDownload = true;
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`Source file not found: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    const isImage = assetType === 'IMAGE' || ['.heic', '.heif', '.avif', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'].includes(ext);

    if (!isImage) {
      // Videos: extract a frame thumbnail via ffmpeg in the transcode processor
      // Mark as done with null paths and proceed to ML
      await this.prisma.assetJobStatus.update({
        where: { assetId },
        data: { thumbnailDoneAt: new Date() },
      });
      return;
    }

    fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

    const smPath = path.join(THUMBNAIL_DIR, `${assetId}-sm.webp`);
    const lgPath = path.join(THUMBNAIL_DIR, `${assetId}-lg.webp`);

    const { path: srcPath, temp } = await toProcessablePath(filePath);
    try {
      await (sharp as any)(srcPath)
        .rotate()           // auto-rotate from EXIF orientation
        .resize(240, 240, { fit: 'cover', position: 'centre' })
        .webp({ quality: 75 })
        .toFile(smPath);

      await (sharp as any)(srcPath)
        .rotate()
        .resize(720, 720, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(lgPath);
    } finally {
      if (temp && fs.existsSync(srcPath)) fs.unlinkSync(srcPath);
    }

    // Upload thumbnails to S3
    const smKey = `thumbnails/${assetId}-sm.webp`;
    const lgKey = `thumbnails/${assetId}-lg.webp`;
    await this.storage.putFile(smPath, smKey, 'image/webp');
    await this.storage.putFile(lgPath, lgKey, 'image/webp');

    await this.prisma.asset.update({
      where: { id: assetId },
      data: {
        thumbnailSmallPath: smKey,   // S3 key
        thumbnailLargePath: lgKey,   // S3 key
      },
    });

    await this.prisma.assetJobStatus.update({
      where: { assetId },
      data: { thumbnailDoneAt: new Date() },
    });

    // Trigger ML jobs with LOCAL paths (ML service reads from mounted volume)
    await this.queueService.enqueueMlJobs(assetId, smPath, filePath);

    // Clean up temp download if we fetched from S3
    if (tempDownload) { try { fs.unlinkSync(filePath); } catch {} }

    this.logger.log(`Thumbnails done for ${assetId}`);
  }
}
