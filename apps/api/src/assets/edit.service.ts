import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { EditAssetDto } from './dto/edit-asset.dto';
import { AssetType } from '@prisma/client';
import axios from 'axios';
import { promisify } from 'util';
import { execFile } from 'child_process';
import * as sharp from 'sharp';
import * as ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const execFileAsync = promisify(execFile);

const ML_URL = process.env.ML_SERVICE_URL || 'http://ml:3003';
const UPLOAD_DIR = process.env.UPLOAD_PATH || '/uploads';
const THUMBNAIL_DIR = process.env.THUMBNAIL_PATH || '/thumbnails';
const HEIC_EXTS = new Set(['.heic', '.heif']);

function runFfmpeg(cmd: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    cmd.on('end', () => resolve()).on('error', reject).run();
  });
}

@Injectable()
export class EditService {
  private readonly logger = new Logger(EditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Apply edits and return the resulting image buffer for preview (not saved). */
  async previewEdit(
    assetId: string,
    ownerId: string,
    dto: EditAssetDto,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const asset = await this.findAsset(assetId, ownerId);
    if ((asset as any).type === AssetType.VIDEO) {
      // For video, preview just returns the poster frame thumbnail
      const sourcePath = this.pickVideoThumbnailPath(asset);
      const tempPath = await this.downloadToTemp(sourcePath, `thumb_${assetId}.webp`);
      try {
        return await this.callMlEdit(tempPath, dto);
      } finally {
        this.cleanup(tempPath);
      }
    }
    const sourcePath = this.pickSourcePath(asset);
    const tempPath = await this.downloadToTemp(sourcePath, this.sourceFileName(asset));
    try {
      return await this.callMlEdit(tempPath, dto);
    } finally {
      this.cleanup(tempPath);
    }
  }

  /** Apply edits and persist the result. For images: ML edit + thumbnail regen. For videos: ffmpeg. */
  async saveEdit(
    assetId: string,
    ownerId: string,
    dto: EditAssetDto,
  ): Promise<any> {
    const asset = await this.findAsset(assetId, ownerId);

    if ((asset as any).type === AssetType.VIDEO) {
      return this.saveVideoEdit(assetId, ownerId, asset, dto);
    }

    const sourcePath = this.pickSourcePath(asset);
    const tempPath = await this.downloadToTemp(sourcePath, this.sourceFileName(asset));
    try {
      const { buffer, mimeType } = await this.callMlEdit(tempPath, dto);
      const ext = mimeType.includes('webp') ? '.webp' : '.jpg';
      const editedKey = `edited/${assetId}/${crypto.randomUUID()}${ext}`;
      await this.storage.putBuffer(editedKey, buffer, mimeType);

      // Delete previous saved edit if any
      const prev = (asset as any).editedPath as string | null;
      if (prev && this.storage.isS3Key(prev)) {
        await this.storage.deleteObject(prev).catch(() => {});
      }

      // Regenerate thumbnails from the edited image so the grid shows the edit
      const smKey = `thumbnails/${assetId}-sm.webp`;
      const lgKey = `thumbnails/${assetId}-lg.webp`;
      try {
        const smBuf = await (sharp as any)(buffer)
          .resize(240, 240, { fit: 'cover', position: 'centre' })
          .webp({ quality: 75 })
          .toBuffer();
        const lgBuf = await (sharp as any)(buffer)
          .resize(720, 720, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer();
        await this.storage.putBuffer(smKey, smBuf, 'image/webp');
        await this.storage.putBuffer(lgKey, lgBuf, 'image/webp');
        // Also write to local thumbnail dir (for non-S3 setups)
        fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
        const smLocal = path.join(THUMBNAIL_DIR, `${assetId}-sm.webp`);
        const lgLocal = path.join(THUMBNAIL_DIR, `${assetId}-lg.webp`);
        fs.writeFileSync(smLocal, smBuf);
        fs.writeFileSync(lgLocal, lgBuf);
      } catch (thumbErr) {
        this.logger.warn(`Thumbnail regen failed for ${assetId}: ${thumbErr}`);
      }

      return this.prisma.asset.update({
        where: { id: assetId },
        data: {
          editedPath: editedKey,
          editParams: dto as any,
          thumbnailSmallPath: smKey,
          thumbnailLargePath: lgKey,
        },
      });
    } finally {
      this.cleanup(tempPath);
    }
  }

  private getVideoFilterStr(name: string): string | null {
    const map: Record<string, string> = {
      noir:       'hue=s=0,curves=preset=strong_contrast',
      tonal:      'hue=s=0',
      vivid:      'eq=brightness=0.03:contrast=1.25:saturation=1.8',
      dramatic:   'eq=contrast=1.4:saturation=0.4',
      warm:       'colorbalance=rs=0.12:rm=0.08:rh=0.05:bs=-0.12:bm=-0.08:bh=-0.05',
      cool:       'colorbalance=rs=-0.12:rm=-0.08:rh=-0.05:bs=0.12:bm=0.08:bh=0.05',
      fade:       'eq=brightness=0.05:contrast=0.7:saturation=0.6',
      matte:      'eq=contrast=0.8:saturation=0.6',
      vintage:    'colorbalance=rs=0.1:rm=0.06:bs=-0.1:bm=-0.06,eq=contrast=0.85:saturation=0.75',
      chrome:     'eq=contrast=1.5:saturation=0.4,colorbalance=bs=0.12:bm=0.08',
      silvertone: 'hue=s=0.15,eq=contrast=1.1',
      cinematic:  'eq=contrast=1.3:saturation=0.7,colorbalance=rs=-0.05:bs=0.08:rm=-0.05:bm=0.05',
      film:       'eq=brightness=0.03:contrast=0.9:saturation=0.85,colorbalance=rs=0.08:rm=0.05',
      instant:    'eq=brightness=0.05:contrast=1.4:saturation=0.9',
      process:    'colorbalance=rs=-0.2:bs=0.3:rm=0.1:bm=-0.1,eq=contrast=1.2',
      transfer:   'eq=brightness=0.04:contrast=0.85:saturation=0.7,colorbalance=rs=0.1:rm=0.06',
    };
    return map[name] ?? null;
  }

  /** Apply ffmpeg-based video edits (trim, speed, mute, filters, color) and re-transcode HLS. */
  private async saveVideoEdit(
    assetId: string,
    ownerId: string,
    asset: any,
    dto: EditAssetDto,
  ): Promise<any> {
    const hasFilter = dto.filter != null && dto.filter !== 'none';
    const hasBCS = (dto.brightness != null && dto.brightness !== 0) ||
                   (dto.contrast   != null && dto.contrast   !== 0) ||
                   (dto.saturation != null && dto.saturation !== 0);
    const hasEdits = dto.trimStartMs != null || dto.trimEndMs != null ||
                     (dto.speed != null && dto.speed !== 1.0) ||
                     dto.muted === true || dto.autoEnhance === true ||
                     hasFilter || hasBCS;

    if (!hasEdits) {
      // Nothing to do
      return this.prisma.asset.update({
        where: { id: assetId },
        data: { editParams: dto as any },
      });
    }

    const originalPath = asset.originalPath as string;
    const tempDir = path.join(UPLOAD_DIR, 'edit_temp');
    fs.mkdirSync(tempDir, { recursive: true });

    // Download original video to temp
    const origExt = path.extname(asset.fileName || originalPath) || '.mp4';
    const origTemp = path.join(tempDir, `orig_${crypto.randomUUID()}${origExt}`);
    if (this.storage.isS3Key(originalPath)) {
      await this.storage.downloadToFile(originalPath, origTemp);
    } else {
      if (!fs.existsSync(originalPath)) throw new NotFoundException('Source video not found');
      fs.copyFileSync(originalPath, origTemp);
    }

    const editedTemp = path.join(tempDir, `edited_${crypto.randomUUID()}.mp4`);
    try {
      // Build ffmpeg filter/option chain
      const outputOptions: string[] = ['-preset fast', '-pix_fmt', 'yuv420p', '-movflags +faststart'];
      const inputOptions: string[] = [];

      // Trim: use -ss/-to on input for accuracy
      if (dto.trimStartMs != null) {
        inputOptions.push(`-ss ${dto.trimStartMs / 1000}`);
      }
      if (dto.trimEndMs != null) {
        // -to relative to the seeked position when -ss is on input
        const endSec = dto.trimEndMs / 1000;
        const startSec = dto.trimStartMs != null ? dto.trimStartMs / 1000 : 0;
        outputOptions.push(`-t ${endSec - startSec}`);
      }

      // Mute
      if (dto.muted) {
        outputOptions.push('-an');
      } else {
        outputOptions.push('-acodec aac', '-b:a 128k');
      }

      // Build combined video filter chain
      const vFilters: string[] = [];

      // Auto-enhance preset
      if (dto.autoEnhance) {
        vFilters.push('eq=brightness=0.05:contrast=1.15:saturation=1.35');
      } else {
        // Manual brightness / contrast / saturation via ffmpeg eq filter
        const eqParts: string[] = [];
        if (dto.brightness && dto.brightness !== 0)
          eqParts.push(`brightness=${dto.brightness.toFixed(3)}`);
        if (dto.contrast && dto.contrast !== 0)
          eqParts.push(`contrast=${(1.0 + dto.contrast).toFixed(3)}`);
        if (dto.saturation && dto.saturation !== 0)
          eqParts.push(`saturation=${Math.max(0, 1.0 + dto.saturation * 2).toFixed(3)}`);
        if (eqParts.length > 0) vFilters.push(`eq=${eqParts.join(':')}`);
      }

      // Named color filter
      if (hasFilter) {
        const fs = this.getVideoFilterStr(dto.filter!);
        if (fs) vFilters.push(fs);
      }

      // Video rotation (transpose filter)
      if (dto.videoRotation && dto.videoRotation !== 0) {
        if (dto.videoRotation === 90) vFilters.push('transpose=1');
        else if (dto.videoRotation === 180) vFilters.push('transpose=1,transpose=1');
        else if (dto.videoRotation === 270) vFilters.push('transpose=2');
      }

      // Video crop (normalized 0-1 coords → ffmpeg crop filter)
      if (dto.videoCrop) {
        const vc = dto.videoCrop;
        vFilters.push(
          `crop=iw*${vc.width.toFixed(6)}:ih*${vc.height.toFixed(6)}:iw*${vc.left.toFixed(6)}:ih*${vc.top.toFixed(6)}`,
        );
      }

      // Straighten (video)
      if (dto.straighten && dto.straighten !== 0) {
        const rad = (dto.straighten * Math.PI) / 180;
        vFilters.push(`rotate=${rad.toFixed(6)}:fillcolor=black`);
      }

      // Flip (video)
      if (dto.flipHorizontal) vFilters.push('hflip');
      if (dto.flipVertical) vFilters.push('vflip');

      // Speed (atempo chain + setpts)
      const speed = dto.speed ?? 1.0;
      if (speed !== 1.0) vFilters.push(`setpts=${(1 / speed).toFixed(6)}*PTS`);
      let audioFilter: string | null = null;
      if (speed !== 1.0 && !dto.muted) {
        const atempos: string[] = [];
        let s = speed;
        while (s > 2.0) { atempos.push('atempo=2.0'); s /= 2.0; }
        while (s < 0.5) { atempos.push('atempo=0.5'); s *= 2.0; }
        atempos.push(`atempo=${s.toFixed(6)}`);
        audioFilter = atempos.join(',');
      }

      // colorbalance/curves filters output yuv444p in ffmpeg 8.x; libx264 then
      // encodes "High 4:4:4 Predictive" which iOS/Android refuse to play.
      // Appending format=yuv420p forces frame conversion before the encoder so
      // the result is always standard yuv420p / High profile.
      vFilters.push('format=yuv420p');
      let cmd = ffmpeg(origTemp).inputOptions(inputOptions);
      cmd = cmd.videoFilter(vFilters.join(','));
      cmd = cmd.videoCodec('libx264').outputOptions(outputOptions);
      if (audioFilter) cmd = cmd.audioFilter(audioFilter);
      cmd = cmd.output(editedTemp);

      await runFfmpeg(cmd);

      // Re-transcode to HLS
      const hlsDir = path.join(UPLOAD_DIR, 'hls', assetId);
      fs.rmSync(hlsDir, { recursive: true, force: true });
      fs.mkdirSync(hlsDir, { recursive: true });

      const probe = await new Promise<ffmpeg.FfprobeData>((res, rej) => {
        ffmpeg.ffprobe(editedTemp, (err, data) => err ? rej(err) : res(data));
      });
      const vStream = probe.streams.find((s) => s.codec_type === 'video');
      const srcHeight = vStream?.height || 720;
      const srcWidth = vStream?.width || 1280;

      const qualities: { label: string; height: number; bitrate: string }[] = [];
      if (srcHeight >= 1080) qualities.push({ label: '1080p', height: 1080, bitrate: '4000k' });
      if (srcHeight >= 720) qualities.push({ label: '720p', height: 720, bitrate: '2000k' });
      qualities.push({ label: '360p', height: 360, bitrate: '800k' });

      const playlistLines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];
      for (const q of qualities) {
        const qDir = path.join(hlsDir, q.label);
        fs.mkdirSync(qDir, { recursive: true });
        await runFfmpeg(
          ffmpeg(editedTemp)
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
              `-vf scale=-2:${q.height},format=yuv420p`,
              '-preset fast', '-crf 23',
              `-b:v ${q.bitrate}`, '-b:a 128k', '-ar 44100',
              '-hls_time 6', '-hls_list_size 0',
              '-hls_segment_filename', path.join(qDir, 'seg%03d.ts'),
              '-f hls',
            ])
            .output(path.join(qDir, 'index.m3u8')),
        );
        playlistLines.push(
          `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(q.bitrate) * 1000},RESOLUTION=${srcWidth}x${q.height}`,
          `${q.label}/index.m3u8`,
        );
      }
      fs.writeFileSync(path.join(hlsDir, 'master.m3u8'), playlistLines.join('\n'));

      // Upload edited HLS segments to S3
      const hlsFiles = this.walkDir(hlsDir);
      for (const f of hlsFiles) {
        const relKey = `hls/${assetId}/${path.relative(hlsDir, f).replace(/\\/g, '/')}`;
        const ext2 = path.extname(f);
        const mime2 = ext2 === '.m3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
        await this.storage.putFile(f, relKey, mime2).catch(() => {});
      }

      // Regenerate poster thumbnail from edited video
      const framePath = path.join(hlsDir, 'poster_edited.jpg');
      try {
        await runFfmpeg(ffmpeg(editedTemp).seekInput(1).frames(1).output(framePath));
        if (fs.existsSync(framePath)) {
          fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
          const smLocal = path.join(THUMBNAIL_DIR, `${assetId}-sm.webp`);
          const lgLocal = path.join(THUMBNAIL_DIR, `${assetId}-lg.webp`);
          await (sharp as any)(framePath).resize(240, 240, { fit: 'cover' }).webp({ quality: 75 }).toFile(smLocal);
          await (sharp as any)(framePath).resize(720, 720, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toFile(lgLocal);
          const smBuf = fs.readFileSync(smLocal);
          const lgBuf = fs.readFileSync(lgLocal);
          await this.storage.putBuffer(`thumbnails/${assetId}-sm.webp`, smBuf, 'image/webp').catch(() => {});
          await this.storage.putBuffer(`thumbnails/${assetId}-lg.webp`, lgBuf, 'image/webp').catch(() => {});
        }
      } catch (e) {
        this.logger.warn(`Video thumbnail regen failed: ${e}`);
      }

      // Persist the edited MP4 for playback/download
      const editedVideoDir = path.join(UPLOAD_DIR, "edited_videos");
      fs.mkdirSync(editedVideoDir, { recursive: true });
      const editedVideoLocalPath = path.join(editedVideoDir, `${assetId}.mp4`);
      fs.copyFileSync(editedTemp, editedVideoLocalPath);
      const editedVideoKey = `edited_videos/${assetId}.mp4`;
      let editedPathToStore: string = editedVideoLocalPath;
      try {
        await this.storage.putFile(editedVideoLocalPath, editedVideoKey, "video/mp4");
        editedPathToStore = editedVideoKey;
      } catch (e) {
        this.logger.warn(`Edited video S3 upload failed, using local path: ${e}`);
      }
      // Clean up previous edited video if re-editing
      const prevEdited = (asset as any).editedPath as string | null;
      if (prevEdited && prevEdited !== editedPathToStore) {
        if (this.storage.isS3Key(prevEdited)) {
          await this.storage.deleteObject(prevEdited).catch(() => {});
        } else if (fs.existsSync(prevEdited)) {
          try { fs.unlinkSync(prevEdited); } catch {}
        }
      }

      return this.prisma.asset.update({
        where: { id: assetId },
        data: {
          editedPath: editedPathToStore,
          editParams: dto as any,
          thumbnailSmallPath: `thumbnails/${assetId}-sm.webp`,
          thumbnailLargePath: `thumbnails/${assetId}-lg.webp`,
        },
      });
    } finally {
      this.cleanup(origTemp);
      this.cleanup(editedTemp);
    }
  }

  private walkDir(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        results.push(...this.walkDir(full));
      } else {
        results.push(full);
      }
    }
    return results;
  }


  /** Return the original image resized to max 1080 px with only EXIF + saved rotation applied.
   *  The mobile crop screen calls this so the user always sees (and crops) in original-image space. */
  async getCropPreview(
    assetId: string,
    ownerId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const asset = await this.findAsset(assetId, ownerId);
    const tempPath = await this.downloadToTemp(this.pickSourcePath(asset), this.sourceFileName(asset));
    try {
      const rotation: number = ((asset as any).editParams as any)?.rotation ?? 0;
      let pipeline = (sharp as any)(tempPath).rotate(); // honour EXIF orientation
      if (rotation === 90 || rotation === 180 || rotation === 270) {
        pipeline = pipeline.rotate(rotation);
      }
      const buffer: Buffer = await pipeline
        .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      return { buffer, mimeType: 'image/jpeg' };
    } finally {
      this.cleanup(tempPath);
    }
  }

  /** Stream the saved edited image. */
  async getEditedImage(assetId: string, ownerId: string): Promise<{ filePath: string; mimeType: string }> {
    const asset = await this.findAsset(assetId, ownerId);
    const editedPath = (asset as any).editedPath as string | null;
    if (!editedPath) throw new NotFoundException('No saved edit for this asset');
    const mimeType = editedPath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return { filePath: editedPath, mimeType };
  }

  /** Remove the saved edit and restore original — handles both images and videos. */
  async revertEdit(assetId: string, ownerId: string): Promise<any> {
    const asset = await this.findAsset(assetId, ownerId);

    if ((asset as any).type === AssetType.VIDEO) {
      return this.revertVideoEdit(assetId, asset);
    }

    // ── Image revert ──────────────────────────────────────────────────────────
    const editedPath = (asset as any).editedPath as string | null;
    if (editedPath && this.storage.isS3Key(editedPath)) {
      await this.storage.deleteObject(editedPath).catch(() => {});
    }

    const smKey = `thumbnails/${assetId}-sm.webp`;
    const lgKey = `thumbnails/${assetId}-lg.webp`;
    try {
      const tempPath = await this.downloadToTemp(
        this.pickSourcePath(asset),
        this.sourceFileName(asset),
      );
      try {
        const buf = fs.readFileSync(tempPath);
        const smBuf = await (sharp as any)(buf)
          .rotate() // auto-apply EXIF orientation
          .resize(240, 240, { fit: 'cover', position: 'centre' })
          .webp({ quality: 75 })
          .toBuffer();
        const lgBuf = await (sharp as any)(buf)
          .rotate() // auto-apply EXIF orientation
          .resize(720, 720, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer();
        await this.storage.putBuffer(smKey, smBuf, 'image/webp');
        await this.storage.putBuffer(lgKey, lgBuf, 'image/webp');
        fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
        fs.writeFileSync(path.join(THUMBNAIL_DIR, `${assetId}-sm.webp`), smBuf);
        fs.writeFileSync(path.join(THUMBNAIL_DIR, `${assetId}-lg.webp`), lgBuf);
      } finally {
        this.cleanup(tempPath);
      }
    } catch (e) {
      this.logger.warn(`Thumbnail restore failed on revert for ${assetId}: ${e}`);
    }

    return this.prisma.asset.update({
      where: { id: assetId },
      data: {
        editedPath: null,
        editParams: null,
        thumbnailSmallPath: smKey,
        thumbnailLargePath: lgKey,
        updatedAt: new Date(),
      },
    });
  }

  /** Re-encode HLS from the original video file, restoring the stream to its unedited state. */
  private async revertVideoEdit(assetId: string, asset: any): Promise<any> {
    const originalPath = asset.originalPath as string;
    const tempDir = path.join(UPLOAD_DIR, 'edit_temp');
    fs.mkdirSync(tempDir, { recursive: true });

    const origExt = path.extname(asset.fileName || originalPath) || '.mp4';
    const origTemp = path.join(tempDir, `orig_${crypto.randomUUID()}${origExt}`);
    if (this.storage.isS3Key(originalPath)) {
      await this.storage.downloadToFile(originalPath, origTemp);
    } else {
      if (!fs.existsSync(originalPath)) throw new NotFoundException('Source video not found');
      fs.copyFileSync(originalPath, origTemp);
    }

    try {
      const hlsDir = path.join(UPLOAD_DIR, 'hls', assetId);
      fs.rmSync(hlsDir, { recursive: true, force: true });
      fs.mkdirSync(hlsDir, { recursive: true });

      const probe = await new Promise<ffmpeg.FfprobeData>((res, rej) => {
        ffmpeg.ffprobe(origTemp, (err, data) => err ? rej(err) : res(data));
      });
      const vStream = probe.streams.find((s) => s.codec_type === 'video');
      const srcHeight = vStream?.height || 720;
      const srcWidth  = vStream?.width  || 1280;

      const qualities: { label: string; height: number; bitrate: string }[] = [];
      if (srcHeight >= 1080) qualities.push({ label: '1080p', height: 1080, bitrate: '4000k' });
      if (srcHeight >= 720)  qualities.push({ label: '720p',  height: 720,  bitrate: '2000k' });
      qualities.push({ label: '360p', height: 360, bitrate: '800k' });

      const playlistLines = ['#EXTM3U', '#EXT-X-VERSION:3'];
      for (const q of qualities) {
        const qDir = path.join(hlsDir, q.label);
        fs.mkdirSync(qDir, { recursive: true });
        await runFfmpeg(
          ffmpeg(origTemp)
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
              `-vf scale=-2:${q.height}`,
              '-preset fast', '-pix_fmt', 'yuv420p', '-crf 23',
              `-b:v ${q.bitrate}`,
              '-b:a 128k',
              '-ar 44100',
              '-hls_time 6', '-hls_list_size 0',
              '-hls_segment_filename', path.join(qDir, 'seg%03d.ts'),
              '-f hls',
            ])
            .output(path.join(qDir, 'index.m3u8')),
        );
        playlistLines.push(
          `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(q.bitrate) * 1000},RESOLUTION=${srcWidth}x${q.height}`,
          `${q.label}/index.m3u8`,
        );
      }
      fs.writeFileSync(path.join(hlsDir, 'master.m3u8'), playlistLines.join('\n'));

      const hlsFiles = this.walkDir(hlsDir);
      for (const f of hlsFiles) {
        const relKey = `hls/${assetId}/${path.relative(hlsDir, f).replace(/\\/g, '/')}`;
        const ext2 = path.extname(f);
        const mime2 = ext2 === '.m3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
        await this.storage.putFile(f, relKey, mime2).catch(() => {});
      }

      // Restore poster thumbnail from original video
      const smKey = `thumbnails/${assetId}-sm.webp`;
      const lgKey = `thumbnails/${assetId}-lg.webp`;
      const framePath = path.join(hlsDir, 'poster_orig.jpg');
      try {
        await runFfmpeg(ffmpeg(origTemp).seekInput(1).frames(1).output(framePath));
        if (fs.existsSync(framePath)) {
          fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
          const smLocal = path.join(THUMBNAIL_DIR, `${assetId}-sm.webp`);
          const lgLocal = path.join(THUMBNAIL_DIR, `${assetId}-lg.webp`);
          await (sharp as any)(framePath).resize(240, 240, { fit: 'cover' }).webp({ quality: 75 }).toFile(smLocal);
          await (sharp as any)(framePath).resize(720, 720, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toFile(lgLocal);
          const smBuf = fs.readFileSync(smLocal);
          const lgBuf = fs.readFileSync(lgLocal);
          await this.storage.putBuffer(smKey, smBuf, 'image/webp').catch(() => {});
          await this.storage.putBuffer(lgKey, lgBuf, 'image/webp').catch(() => {});
        }
      } catch (e) {
        this.logger.warn(`Video thumbnail restore failed on revert for ${assetId}: ${e}`);
      }

      // Clean up persisted edited video
      const editedVideoPath = (asset as any).editedPath as string | null;
      if (editedVideoPath) {
        if (this.storage.isS3Key(editedVideoPath)) {
          await this.storage.deleteObject(editedVideoPath).catch(() => {});
        }
        const localFallback = path.join(UPLOAD_DIR, "edited_videos", `${assetId}.mp4`);
        if (fs.existsSync(localFallback)) {
          try { fs.unlinkSync(localFallback); } catch {}
        }
      }

      return this.prisma.asset.update({
        where: { id: assetId },
        data: {
          editParams: null,
          editedPath: null,
          thumbnailSmallPath: smKey,
          thumbnailLargePath: lgKey,
        },
      });
    } finally {
      this.cleanup(origTemp);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async findAsset(id: string, ownerId: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset || asset.isDeleted) throw new NotFoundException('Asset not found');
    if (asset.ownerId !== ownerId) throw new ForbiddenException('Access denied');
    return asset;
  }

  private pickSourcePath(asset: any): string {
    return asset.originalPath;
  }

  private pickVideoThumbnailPath(asset: any): string {
    const thumb = asset.thumbnailLargePath || asset.thumbnailSmallPath;
    if (!thumb) throw new BadRequestException('Video thumbnail not available');
    return thumb;
  }

  private sourceFileName(asset: any): string {
    return asset.fileName;
  }

  private async downloadToTemp(sourcePath: string, fileName: string): Promise<string> {
    const tempDir = path.join(UPLOAD_DIR, 'edit_temp');
    fs.mkdirSync(tempDir, { recursive: true });

    const ext = path.extname(fileName).toLowerCase() || '.jpg';
    const rawTemp = path.join(tempDir, `${crypto.randomUUID()}${ext}`);

    if (this.storage.isS3Key(sourcePath)) {
      await this.storage.downloadToFile(sourcePath, rawTemp);
    } else {
      if (!fs.existsSync(sourcePath)) throw new NotFoundException('Source file not found');
      fs.copyFileSync(sourcePath, rawTemp);
    }

    if (HEIC_EXTS.has(ext)) {
      const jpgTemp = rawTemp + '.jpg';
      try {
        await execFileAsync('heif-convert', [rawTemp, jpgTemp]);
      } catch (err: any) {
        this.cleanup(rawTemp);
        throw new BadRequestException(`HEIC conversion failed: ${err.message}`);
      }
      this.cleanup(rawTemp);
      return jpgTemp;
    }

    return rawTemp;
  }

  async batchEdit(ownerId: string, assetIds: string[], editParams: Record<string, unknown>): Promise<{ queued: number; failed: number }> {
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds }, ownerId, isDeleted: false },
      select: { id: true },
    });
    let failed = 0;
    for (const asset of assets) {
      try {
        await this.saveEdit(asset.id, ownerId, editParams as any);
      } catch {
        failed++;
      }
    }
    return { queued: assets.length, failed };
  }

  private async callMlEdit(
    imagePath: string,
    dto: EditAssetDto,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const operations = {
      rotation:       dto.rotation       ?? 0,
      straighten:     dto.straighten     ?? 0,
      perspective_v:  dto.perspectiveV   ?? 0,
      perspective_h:  dto.perspectiveH   ?? 0,
      flip_horizontal: dto.flipHorizontal ?? false,
      flip_vertical:   dto.flipVertical   ?? false,
      aspect_ratio:    dto.aspectRatio    ?? null,
      crop: dto.crop
        ? { left: dto.crop.left, top: dto.crop.top, width: dto.crop.width, height: dto.crop.height }
        : null,
      unblur:         dto.unblur         ?? 0,
      portrait_blur:  dto.portraitBlur   ?? 0,
      pop:            dto.pop            ?? 0,
      magic_eraser:   dto.magicEraser
        ? { left: dto.magicEraser.left, top: dto.magicEraser.top, width: dto.magicEraser.width, height: dto.magicEraser.height }
        : null,
      filter:           dto.filter           ?? 'none',
      filter_intensity: dto.filterIntensity  ?? 1.0,
      sky_style:        dto.skyStyle         ?? 'none',
      sky_intensity:    dto.skyIntensity     ?? 1.0,
      hdr:            dto.hdr            ?? false,
      portrait_light: dto.portraitLight  ?? false,
      brightness:     dto.brightness     ?? 0,
      contrast:       dto.contrast       ?? 0,
      tone:           dto.tone           ?? 0,
      white_point:    dto.whitePoint     ?? 1.0,
      black_point:    dto.blackPoint     ?? 0.0,
      highlights:     dto.highlights     ?? 0,
      shadows:        dto.shadows        ?? 0,
      vignette:       dto.vignette       ?? 0,
      saturation:     dto.saturation     ?? 0,
      warmth:         dto.warmth         ?? 0,
      tint:           dto.tint           ?? 0,
      skin_tone:      dto.skinTone       ?? 0,
      blue_tone:      dto.blueTone       ?? 0,
    };

    const res = await axios.post(
      `${ML_URL}/edit/image`,
      { image_path: imagePath, operations },
      { responseType: 'arraybuffer', timeout: 120_000 },
    );

    const contentType = (res.headers['content-type'] as string) || 'image/jpeg';
    return { buffer: Buffer.from(res.data as ArrayBuffer), mimeType: contentType };
  }

  async applyRedEye(ownerId: string, assetId: string): Promise<{ url: string }> {
    const asset = await this.findAsset(assetId, ownerId);
    if (asset.type !== 'PHOTO') throw new BadRequestException('Only photos support red-eye removal');
    const rawPath = path.join(UPLOAD_DIR, asset.editedPath || asset.originalPath);

    const res = await axios.post(
      `${ML_URL}/edit/red-eye`,
      { image_path: rawPath },
      { responseType: 'arraybuffer', timeout: 60_000 },
    );

    const buf = Buffer.from(res.data as ArrayBuffer);
    const editedName = `edited/${assetId}_redeye_${crypto.randomBytes(4).toString('hex')}.jpg`;
    const editedPath = path.join(UPLOAD_DIR, editedName);
    fs.mkdirSync(path.dirname(editedPath), { recursive: true });
    fs.writeFileSync(editedPath, buf);

    await this.prisma.asset.update({
      where: { id: assetId },
      data: { editedPath: editedName },
    });

    return { url: this.storage.getServeUrl(editedName) };
  }

  async applyMarkup(
    ownerId: string,
    assetId: string,
    annotations: Array<{
      type: 'line' | 'arrow' | 'rect' | 'circle' | 'text';
      color?: string;
      thickness?: number;
      points?: number[];
      center?: number[];
      radius?: number;
      topLeft?: number[];
      bottomRight?: number[];
      position?: number[];
      text?: string;
      fontSize?: number;
    }>,
  ): Promise<{ url: string }> {
    const asset = await this.findAsset(assetId, ownerId);
    if (asset.type !== 'PHOTO') throw new BadRequestException('Only photos support markup');
    const rawPath = path.join(UPLOAD_DIR, asset.editedPath || asset.originalPath);

    const res = await axios.post(
      `${ML_URL}/edit/markup`,
      { image_path: rawPath, annotations },
      { responseType: 'arraybuffer', timeout: 60_000 },
    );

    const buf = Buffer.from(res.data as ArrayBuffer);
    const editedName = `edited/${assetId}_markup_${crypto.randomBytes(4).toString('hex')}.png`;
    const editedPath = path.join(UPLOAD_DIR, editedName);
    fs.mkdirSync(path.dirname(editedPath), { recursive: true });
    fs.writeFileSync(editedPath, buf);

    await this.prisma.asset.update({
      where: { id: assetId },
      data: { editedPath: editedName },
    });

    return { url: this.storage.getServeUrl(editedName) };
  }

  async applyDepthBlur(
    ownerId: string,
    assetId: string,
    blurStrength?: number,
    focusPoint?: { x: number; y: number },
  ): Promise<{ url: string }> {
    const asset = await this.findAsset(assetId, ownerId);
    if (asset.type !== 'PHOTO') throw new BadRequestException('Only photos support depth blur');
    const rawPath = path.join(UPLOAD_DIR, asset.editedPath || asset.originalPath);

    const res = await axios.post(
      `${ML_URL}/edit/depth-blur`,
      {
        image_path: rawPath,
        blur_strength: blurStrength ?? 15,
        focus_point: focusPoint ?? null,
      },
      { responseType: 'arraybuffer', timeout: 120_000 },
    );

    const buf = Buffer.from(res.data as ArrayBuffer);
    const editedName = `edited/${assetId}_depthblur_${crypto.randomBytes(4).toString('hex')}.jpg`;
    const editedPath = path.join(UPLOAD_DIR, editedName);
    fs.mkdirSync(path.dirname(editedPath), { recursive: true });
    fs.writeFileSync(editedPath, buf);

    await this.prisma.asset.update({
      where: { id: assetId },
      data: { editedPath: editedName },
    });

    return { url: this.storage.getServeUrl(editedName) };
  }

  private cleanup(filePath: string): void {
    try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  }
}
