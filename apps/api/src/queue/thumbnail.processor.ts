import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from './queue.service';

const THUMBNAIL_DIR = process.env.THUMBNAIL_PATH || '/thumbnails';

@Processor('thumbnail')
export class ThumbnailProcessor extends WorkerHost {
  private readonly logger = new Logger(ThumbnailProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {
    super();
  }

  async process(job: Job<{ assetId: string; filePath: string; assetType: string }>) {
    const { assetId, filePath, assetType } = job.data;
    this.logger.log(`Generating thumbnails for asset ${assetId}`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Source file not found: ${filePath}`);
    }

    if (assetType === 'VIDEO') {
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

    await (sharp as any)(filePath)
      .rotate()           // auto-rotate from EXIF orientation
      .resize(240, 240, { fit: 'cover', position: 'centre' })
      .webp({ quality: 75 })
      .toFile(smPath);

    await (sharp as any)(filePath)
      .rotate()
      .resize(720, 720, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(lgPath);

    await this.prisma.asset.update({
      where: { id: assetId },
      data: {
        thumbnailSmallPath: smPath,
        thumbnailLargePath: lgPath,
      },
    });

    await this.prisma.assetJobStatus.update({
      where: { assetId },
      data: { thumbnailDoneAt: new Date() },
    });

    // Trigger ML jobs now that thumbnail is ready
    await this.queueService.enqueueMlJobs(assetId, smPath, filePath);

    this.logger.log(`Thumbnails done for ${assetId}`);
  }
}
