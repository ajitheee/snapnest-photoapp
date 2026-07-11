import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import * as ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const UPLOAD_DIR = process.env.UPLOAD_PATH || '/uploads';
const THUMBNAIL_DIR = process.env.THUMBNAIL_PATH || '/thumbnails';

function runFfmpeg(cmd: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    cmd.on('end', () => resolve()).on('error', reject).run();
  });
}

export type LiveEffect = 'loop' | 'bounce' | 'long_exposure';

@Injectable()
export class LivePhotoEffectsService {
  private readonly logger = new Logger(LivePhotoEffectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async applyLiveEffect(
    userId: string,
    assetId: string,
    effect: LiveEffect,
  ): Promise<{ url: string }> {
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, ownerId: userId, isDeleted: false },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    if (!asset.livePhotoVideoPath) {
      throw new BadRequestException('Asset is not a Live Photo');
    }

    const videoPath = path.join(UPLOAD_DIR, asset.livePhotoVideoPath);
    if (!fs.existsSync(videoPath)) {
      throw new BadRequestException('Live Photo video file missing');
    }

    const outputName = `live-effects/${assetId}_${effect}_${crypto.randomBytes(4).toString('hex')}.mp4`;
    const outputPath = path.join(UPLOAD_DIR, outputName);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    switch (effect) {
      case 'loop':
        await this.createLoop(videoPath, outputPath);
        break;
      case 'bounce':
        await this.createBounce(videoPath, outputPath);
        break;
      case 'long_exposure':
        await this.createLongExposure(videoPath, outputPath, assetId);
        break;
    }

    await this.prisma.asset.update({
      where: { id: assetId },
      data: { liveEffect: effect, liveEffectPath: outputName },
    });

    const url = this.storage.getServeUrl(outputName);
    return { url };
  }

  async removeLiveEffect(userId: string, assetId: string): Promise<void> {
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, ownerId: userId, isDeleted: false },
    });
    if (!asset) throw new NotFoundException('Asset not found');

    if (asset.liveEffectPath) {
      const effectPath = path.join(UPLOAD_DIR, asset.liveEffectPath);
      if (fs.existsSync(effectPath)) fs.unlinkSync(effectPath);
    }

    await this.prisma.asset.update({
      where: { id: assetId },
      data: { liveEffect: null, liveEffectPath: null },
    });
  }

  async setKeyPhoto(
    userId: string,
    assetId: string,
    timestampMs: number,
  ): Promise<{ thumbnailUrl: string }> {
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, ownerId: userId, isDeleted: false },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    if (!asset.livePhotoVideoPath) {
      throw new BadRequestException('Asset is not a Live Photo');
    }

    const videoPath = path.join(UPLOAD_DIR, asset.livePhotoVideoPath);
    const thumbPath = path.join(THUMBNAIL_DIR, `${assetId}_thumb.webp`);
    const largePath = path.join(THUMBNAIL_DIR, `${assetId}_large.webp`);

    const timeSeconds = (timestampMs / 1000).toFixed(3);

    await runFfmpeg(
      ffmpeg(videoPath)
        .seekInput(parseFloat(timeSeconds))
        .frames(1)
        .outputOptions(['-vf', 'scale=250:-2', '-q:v', '80'])
        .output(thumbPath),
    );

    await runFfmpeg(
      ffmpeg(videoPath)
        .seekInput(parseFloat(timeSeconds))
        .frames(1)
        .outputOptions(['-vf', 'scale=1920:-2', '-q:v', '90'])
        .output(largePath),
    );

    await this.prisma.asset.update({
      where: { id: assetId },
      data: { keyPhotoTimestampMs: timestampMs },
    });

    return { thumbnailUrl: this.storage.getServeUrl(`${assetId}_thumb.webp`) };
  }

  private async createLoop(input: string, output: string): Promise<void> {
    const tempConcat = output + '.concat.txt';
    const entry = `file '${input.replace(/'/g, "'\\''")}'`;
    fs.writeFileSync(tempConcat, `${entry}\n${entry}\n${entry}\n`);

    await runFfmpeg(
      ffmpeg()
        .input(tempConcat)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .videoCodec('libx264')
        .outputOptions(['-preset', 'fast', '-crf', '23', '-an', '-movflags', '+faststart'])
        .output(output),
    );

    fs.unlinkSync(tempConcat);
  }

  private async createBounce(input: string, output: string): Promise<void> {
    const tempReversed = output + '.rev.mp4';

    await runFfmpeg(
      ffmpeg(input)
        .videoFilter('reverse')
        .videoCodec('libx264')
        .outputOptions(['-preset', 'fast', '-crf', '23', '-an'])
        .output(tempReversed),
    );

    const concatFile = output + '.concat.txt';
    fs.writeFileSync(
      concatFile,
      `file '${input.replace(/'/g, "'\\''")}'
file '${tempReversed.replace(/'/g, "'\\''")}'
`,
    );

    await runFfmpeg(
      ffmpeg()
        .input(concatFile)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .videoCodec('libx264')
        .outputOptions(['-preset', 'fast', '-crf', '23', '-an', '-movflags', '+faststart'])
        .output(output),
    );

    fs.unlinkSync(tempReversed);
    fs.unlinkSync(concatFile);
  }

  private async createLongExposure(
    input: string,
    output: string,
    assetId: string,
  ): Promise<void> {
    const framesDir = path.join(UPLOAD_DIR, 'live-effects', `${assetId}_frames`);
    fs.mkdirSync(framesDir, { recursive: true });

    await runFfmpeg(
      ffmpeg(input)
        .outputOptions(['-vf', 'fps=15'])
        .output(path.join(framesDir, 'frame_%04d.png')),
    );

    const frameFiles = fs.readdirSync(framesDir)
      .filter((f) => f.endsWith('.png'))
      .sort()
      .map((f) => path.join(framesDir, f));

    if (frameFiles.length === 0) {
      fs.rmSync(framesDir, { recursive: true, force: true });
      throw new BadRequestException('Could not extract frames from Live Photo video');
    }

    // Use ffmpeg tblend for frame averaging (simulated long exposure)
    await runFfmpeg(
      ffmpeg(input)
        .videoFilter([
          'fps=15',
          `tblend=all_mode=average`,
          'setpts=N/15/TB',
        ])
        .frames(1)
        .outputOptions(['-q:v', '2'])
        .output(output.replace('.mp4', '.jpg')),
    );

    // The long exposure produces a still image, not a video
    const stillPath = output.replace('.mp4', '.jpg');
    if (fs.existsSync(stillPath)) {
      fs.renameSync(stillPath, output.replace('.mp4', '.jpg'));
    }

    fs.rmSync(framesDir, { recursive: true, force: true });

    // For long exposure, we store the blended still as the effect output
    const finalOutput = output.replace('.mp4', '.jpg');
    if (!fs.existsSync(finalOutput)) {
      // Fallback: just average all frames manually via ffmpeg
      await runFfmpeg(
        ffmpeg(input)
          .videoFilter('tblend=all_mode=average,select=eq(n\\,0)')
          .frames(1)
          .output(finalOutput),
      );
    }
  }
}
