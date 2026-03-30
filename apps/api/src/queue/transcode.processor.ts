import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as fs from 'fs';
import * as sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from './queue.service';
import { StorageService } from '../storage/storage.service';

const UPLOAD_DIR = process.env.UPLOAD_PATH || '/uploads';
const THUMBNAIL_DIR = process.env.THUMBNAIL_PATH || '/thumbnails';

function ffprobe(filePath: string): Promise<ffmpeg.FfprobeData> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function runFfmpeg(cmd: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    cmd.on('end', () => resolve()).on('error', reject).run();
  });
}

@Processor('transcode')
export class TranscodeProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscodeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<{ assetId: string; filePath: string }>) {
    const { assetId, filePath } = job.data;
    this.logger.log(`Transcoding video ${assetId}`);

    // Probe
    const probe = await ffprobe(filePath);
    const videoStream = probe.streams.find((s) => s.codec_type === 'video');
    const duration = Math.round(probe.format.duration || 0);
    const width = videoStream?.width;
    const height = videoStream?.height;

    // HLS output directory
    const hlsDir = path.join(UPLOAD_DIR, 'hls', assetId);
    fs.mkdirSync(hlsDir, { recursive: true });

    // Determine quality levels based on source height
    const srcHeight = height || 1080;
    const qualities: { label: string; height: number; bitrate: string }[] = [];
    if (srcHeight >= 1080) qualities.push({ label: '1080p', height: 1080, bitrate: '4000k' });
    if (srcHeight >= 720) qualities.push({ label: '720p', height: 720, bitrate: '2000k' });
    qualities.push({ label: '360p', height: 360, bitrate: '800k' });

    const playlistLines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];

    for (const q of qualities) {
      const qDir = path.join(hlsDir, q.label);
      fs.mkdirSync(qDir, { recursive: true });

      await runFfmpeg(
        ffmpeg(filePath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions([
            `-vf scale=-2:${q.height}`,
            '-preset fast',
            '-crf 23',
            `-b:v ${q.bitrate}`,
            '-hls_time 6',
            '-hls_list_size 0',
            '-hls_segment_filename',
            path.join(qDir, 'seg%03d.ts'),
            '-f hls',
          ])
          .output(path.join(qDir, 'index.m3u8')),
      );

      playlistLines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(q.bitrate) * 1000},RESOLUTION=${width || 1920}x${q.height}`,
        `${q.label}/index.m3u8`,
      );
    }

    fs.writeFileSync(path.join(hlsDir, 'master.m3u8'), playlistLines.join('\n'));

    // Extract poster frame at 1s for thumbnail
    const smPath = path.join(THUMBNAIL_DIR, `${assetId}-sm.webp`);
    const lgPath = path.join(THUMBNAIL_DIR, `${assetId}-lg.webp`);
    const framePath = path.join(hlsDir, 'poster.jpg');

    await runFfmpeg(
      ffmpeg(filePath)
        .seekInput(1)
        .frames(1)
        .output(framePath),
    );

    if (fs.existsSync(framePath)) {
      await (sharp as any)(framePath)
        .resize(240, 240, { fit: 'cover' })
        .webp({ quality: 75 })
        .toFile(smPath);
      await (sharp as any)(framePath)
        .resize(720, 720, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(lgPath);
    }

    // Upload thumbnails to S3
    const smKey = `thumbnails/${assetId}-sm.webp`;
    const lgKey = `thumbnails/${assetId}-lg.webp`;
    let smS3Key: string | undefined;
    let lgS3Key: string | undefined;
    if (fs.existsSync(smPath)) {
      await this.storage.putFile(smPath, smKey, 'image/webp');
      smS3Key = smKey;
    }
    if (fs.existsSync(lgPath)) {
      await this.storage.putFile(lgPath, lgKey, 'image/webp');
      lgS3Key = lgKey;
    }

    // Upload HLS directory to S3
    await this.storage.uploadDir(hlsDir, `hls/${assetId}`);

    await this.prisma.asset.update({
      where: { id: assetId },
      data: {
        duration,
        ...(width && { width }),
        ...(height && { height }),
        ...(smS3Key && { thumbnailSmallPath: smS3Key }),
        ...(lgS3Key && { thumbnailLargePath: lgS3Key }),
      },
    });

    await this.prisma.assetJobStatus.update({
      where: { assetId },
      data: { transcodeDoneAt: new Date() },
    });

    // Trigger ML with LOCAL paths (ML service reads from mounted volume)
    await this.queueService.enqueueMlJobs(
      assetId,
      fs.existsSync(smPath) ? smPath : filePath,
      filePath,
    );

    this.logger.log(`Transcode done for ${assetId} (${duration}s, ${qualities.map((q) => q.label).join('/')})`);
  }
}
