import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execFileAsync = promisify(execFile);

const RECAP_PHOTO_LIMIT = 15;
const SLIDE_DURATION = 4;
const TRANSITION_DURATION = 1;
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const OUTPUT_FPS = 30;

@Injectable()
export class RecapService {
  private readonly logger = new Logger(RecapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 10 * * 0')
  async generateWeeklyRecapsForAllUsers() {
    this.logger.log('Weekly recap cron triggered — generating recaps for all users');
    const users = await this.prisma.user.findMany({ select: { id: true } });
    for (const user of users) {
      try {
        await this.generateWeeklyRecap(user.id);
      } catch (err: any) {
        this.logger.error(`Recap failed for user ${user.id}: ${err.message}`);
      }
    }
  }

  async generateWeeklyRecap(ownerId: string, forDate?: Date): Promise<any> {
    const base = forDate || new Date();
    const weekEnd = startOfDay(base);
    const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

    const existing = await this.prisma.recap.findUnique({
      where: { ownerId_weekStart: { ownerId, weekStart } },
    });
    if (existing && existing.status === 'READY') return existing;

    const assets = await this.prisma.asset.findMany({
      where: {
        ownerId,
        isDeleted: false,
        isArchived: false,
        fileCreatedAt: { gte: weekStart, lt: weekEnd },
      },
      include: {
        tags: true,
        faces: { include: { person: true } },
      },
      orderBy: { fileCreatedAt: 'asc' },
    });

    if (assets.length === 0) {
      this.logger.log(`No assets this week for user ${ownerId} — skipping recap`);
      return null;
    }

    const selected = this.selectBestPhotos(assets);
    const assetIds = selected.map(a => a.id);

    const locations = new Set<string>();
    const people = new Set<string>();
    for (const a of selected) {
      if (a.locationCity) locations.add(a.locationCity);
      for (const f of a.faces) {
        if (f.person?.name) people.add(f.person.name);
      }
    }

    const recap = await this.prisma.recap.upsert({
      where: { ownerId_weekStart: { ownerId, weekStart } },
      create: {
        ownerId,
        weekStart,
        weekEnd,
        assetIds,
        photoCount: selected.length,
        locationSummary: locations.size > 0 ? Array.from(locations).join(', ') : null,
        peopleSummary: people.size > 0 ? Array.from(people).join(', ') : null,
        status: 'GENERATING',
      },
      update: {
        assetIds,
        photoCount: selected.length,
        locationSummary: locations.size > 0 ? Array.from(locations).join(', ') : null,
        peopleSummary: people.size > 0 ? Array.from(people).join(', ') : null,
        status: 'GENERATING',
      },
    });

    try {
      const { videoPath, coverPath } = await this.renderRecapVideo(recap.id, ownerId, selected);

      const updated = await this.prisma.recap.update({
        where: { id: recap.id },
        data: { videoPath, coverPath, status: 'READY' },
      });

      await this.notifications.sendToUser(ownerId, {
        title: 'Your Week in Photos',
        body: `${selected.length} moments from your week — tap to watch your recap!`,
        data: { type: 'WEEKLY_RECAP', recapId: recap.id },
      });

      return updated;
    } catch (err: any) {
      this.logger.error(`Video generation failed for recap ${recap.id}: ${err.message}`);
      await this.prisma.recap.update({
        where: { id: recap.id },
        data: { status: 'FAILED' },
      });
      throw err;
    }
  }

  private selectBestPhotos(assets: any[]): any[] {
    const scored = assets.map(a => {
      let score = 0;
      if (a.isFavorite) score += 30;
      if (a.faces.length > 0) score += 20;
      if (a.faces.some((f: any) => f.person?.name)) score += 10;
      if (a.locationCity) score += 10;
      if (a.tags.length > 0) score += 5;
      if (a.type === 'IMAGE') score += 5;
      const mp = ((a.width || 0) * (a.height || 0)) / 1_000_000;
      if (mp >= 2) score += 5;
      score += Math.random() * 10;
      return { asset: a, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const selected: any[] = [];
    const usedHours = new Set<string>();

    for (const { asset } of scored) {
      if (selected.length >= RECAP_PHOTO_LIMIT) break;
      const hourKey = new Date(asset.fileCreatedAt).toISOString().slice(0, 13);
      if (usedHours.has(hourKey) && selected.length >= 5) continue;
      usedHours.add(hourKey);
      selected.push(asset);
    }

    selected.sort((a, b) =>
      new Date(a.fileCreatedAt).getTime() - new Date(b.fileCreatedAt).getTime()
    );

    return selected;
  }

  private async renderRecapVideo(
    recapId: string,
    ownerId: string,
    assets: any[],
  ): Promise<{ videoPath: string; coverPath: string }> {
    const tmpDir = path.join(os.tmpdir(), `recap-${recapId}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      const imagePaths: string[] = [];
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        const ext = asset.mimeType?.includes('png') ? 'png' : 'jpg';
        const localPath = path.join(tmpDir, `slide_${String(i).padStart(3, '0')}.${ext}`);

        const key = asset.thumbnailLargePath || asset.originalPath;
        if (this.storage.isS3Key(key)) {
          await this.storage.downloadToFile(key, localPath);
        } else {
          fs.copyFileSync(key, localPath);
        }
        imagePaths.push(localPath);
      }

      const coverS3Key = `recaps/${ownerId}/${recapId}/cover.jpg`;
      if (imagePaths.length > 0) {
        const coverLocal = path.join(tmpDir, 'cover.jpg');
        await execFileAsync('ffmpeg', [
          '-i', imagePaths[0],
          '-vf', `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`,
          '-q:v', '2', '-y', coverLocal,
        ]);
        await this.storage.putFile(coverLocal, coverS3Key, 'image/jpeg');
      }

      const videoLocal = path.join(tmpDir, 'recap.mp4');
      await this.generateSlideshow(imagePaths, videoLocal);

      const videoS3Key = `recaps/${ownerId}/${recapId}/recap.mp4`;
      await this.storage.putFile(videoLocal, videoS3Key, 'video/mp4');

      return { videoPath: videoS3Key, coverPath: coverS3Key };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  private async generateSlideshow(imagePaths: string[], outputPath: string): Promise<void> {
    if (imagePaths.length === 0) throw new Error('No images to render');

    const inputs: string[] = [];
    const filterParts: string[] = [];

    for (let i = 0; i < imagePaths.length; i++) {
      inputs.push('-loop', '1', '-t', String(SLIDE_DURATION), '-i', imagePaths[i]);
      filterParts.push(
        `[${i}:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${OUTPUT_FPS},format=yuv420p[v${i}]`
      );
    }

    if (imagePaths.length === 1) {
      const filter = filterParts[0];
      await execFileAsync('ffmpeg', [
        ...inputs,
        '-filter_complex', filter,
        '-map', '[v0]',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        '-y', outputPath,
      ], { timeout: 120_000 });
      return;
    }

    let xfadeChain = '';
    const totalSlides = imagePaths.length;

    for (let i = 0; i < totalSlides - 1; i++) {
      const prevLabel = i === 0 ? `[v0]` : `[xf${i - 1}]`;
      const nextLabel = `[v${i + 1}]`;
      const outLabel = i === totalSlides - 2 ? `[out]` : `[xf${i}]`;
      const offset = (i + 1) * SLIDE_DURATION - (i + 1) * TRANSITION_DURATION;
      const transitions = ['fade', 'slideright', 'slideleft', 'slideup', 'slidedown', 'circlecrop', 'dissolve'];
      const transition = transitions[i % transitions.length];
      xfadeChain += `${prevLabel}${nextLabel}xfade=transition=${transition}:duration=${TRANSITION_DURATION}:offset=${offset}${outLabel};`;
    }

    const fullFilter = filterParts.join(';') + ';' + xfadeChain.slice(0, -1);

    await execFileAsync('ffmpeg', [
      ...inputs,
      '-filter_complex', fullFilter,
      '-map', '[out]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-y', outputPath,
    ], { timeout: 300_000 });
  }

  async getRecaps(ownerId: string) {
    return this.prisma.recap.findMany({
      where: { ownerId, status: 'READY' },
      orderBy: { weekStart: 'desc' },
      take: 52,
    });
  }

  async getRecap(ownerId: string, recapId: string) {
    return this.prisma.recap.findFirst({
      where: { id: recapId, ownerId },
    });
  }

  async streamRecapVideo(recapId: string, ownerId: string) {
    const recap = await this.prisma.recap.findFirst({
      where: { id: recapId, ownerId, status: 'READY' },
    });
    if (!recap || !recap.videoPath) return null;
    const stream = await this.storage.getStream(recap.videoPath);
    return { stream, contentType: 'video/mp4' };
  }

  async getRecapCover(recapId: string, ownerId: string) {
    const recap = await this.prisma.recap.findFirst({
      where: { id: recapId, ownerId },
    });
    if (!recap || !recap.coverPath) return null;
    const stream = await this.storage.getStream(recap.coverPath);
    return { stream, contentType: 'image/jpeg' };
  }
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
