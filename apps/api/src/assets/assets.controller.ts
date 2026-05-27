import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  ParseIntPipe,
  DefaultValuePipe,
  Body,
  Res,
  NotFoundException,
  HttpCode,
  HttpStatus,
  ParseIntPipe as ParseInt,
  RawBodyRequest,
  BadRequestException,
} from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const archiver = require('archiver');
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import { extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Response, Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AssetsService } from './assets.service';
import { EditService } from './edit.service';
import { StorageService } from '../storage/storage.service';
import { UploadAssetDto } from './dto/upload-asset.dto';
import { CheckHashesDto } from './dto/check-hashes.dto';
import { CreateUploadSessionDto } from './dto/create-upload-session.dto';
import { EditAssetDto } from './dto/edit-asset.dto';
import { User } from '@prisma/client';
import * as fs from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const uploadStorage = diskStorage({
  destination: process.env.UPLOAD_PATH || '/uploads',
  filename: (_req, file, cb) => {
    cb(null, `${uuidv4()}${extname(file.originalname)}`);
  },
});

// Same storage config reused for the live-photo video companion
const liveVideoStorage = diskStorage({
  destination: process.env.UPLOAD_PATH || '/uploads',
  filename: (_req, file, cb) => {
    cb(null, `live_${uuidv4()}${extname(file.originalname)}`);
  },
});

function serializeAsset(a: any) {
  return { ...a, fileSizeBytes: a.fileSizeBytes.toString() };
}

@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(
    private readonly assetsService: AssetsService,
    private readonly storage: StorageService,
    private readonly editService: EditService,
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage, limits: { fileSize: 500 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadAssetDto,
    @Request() req: { user: User },
  ) {
    if (!file) throw new NotFoundException('No file provided');
    const lat = dto.locationLat ? parseFloat(dto.locationLat) : undefined;
    const lng = dto.locationLng ? parseFloat(dto.locationLng) : undefined;
    const asset = await this.assetsService.uploadAsset(
      req.user.id, file, dto.fileCreatedAt, dto.deviceAssetId,
      isFinite(lat!) ? lat : undefined,
      isFinite(lng!) ? lng : undefined,
      dto.isLivePhoto,
    );
    return serializeAsset(asset);
  }

  // --- Collection endpoints (must be before :id routes) ---

  @Get('favorites')
  async favorites(
    @Request() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const result = await this.assetsService.findFavorites(req.user.id, page, limit);
    return { ...result, assets: result.assets.map(serializeAsset) };
  }

  @Get('archived')
  async archived(
    @Request() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const result = await this.assetsService.findArchived(req.user.id, page, limit);
    return { ...result, assets: result.assets.map(serializeAsset) };
  }

  @Get('map')
  async mapAssets(@Request() req: { user: User }) {
    const assets = await this.assetsService.findWithGps(req.user.id);
    return assets.map(serializeAsset);
  }

  @Get('explore')
  async explore(@Request() req: { user: User }) {
    return this.assetsService.getExploreSummary(req.user.id);
  }

  @Post('reprocess-thumbnails')
  async reprocessThumbnails(@Request() req: { user: User }) {
    return this.assetsService.reprocessMissingThumbnails(req.user.id);
  }

  @Post('download-zip')
  async downloadZip(
    @Body('assetIds') assetIds: string[],
    @Request() req: { user: any },
    @Res() res: Response,
  ) {
    if (!assetIds?.length) throw new BadRequestException('No asset IDs provided');
    const assets = await Promise.all(
      assetIds.map(id => this.assetsService.findOne(id, req.user.id))
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="photos-${Date.now()}.zip"`);
    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res as any);
    for (const asset of assets) {
      const filePath: string = (asset as any).originalPath;
      const fileName: string = (asset as any).fileName;
      if (!filePath) continue;
      if (this.storage.isS3Key(filePath)) {
        const stream = await this.storage.getStream(filePath);
        archive.append(stream, { name: fileName });
      } else if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: fileName });
      }
    }
    await archive.finalize();
  }

  @Get('trashed')
  async trashed(
    @Request() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const result = await this.assetsService.findTrashed(req.user.id, page, limit);
    return { ...result, assets: result.assets.map(serializeAsset) };
  }

  @Get('videos')
  async videos(
    @Request() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('month') month?: string,
  ) {
    const result = await this.assetsService.findVideos(req.user.id, page, limit, month);
    return { ...result, assets: result.assets.map(serializeAsset) };
  }


  /**
   * GET /assets/live-photos-missing-video
   * Returns deviceAssetId list of live photos that have no companion video yet.
   * Mobile app uses this to backfill live photo videos from the device library.
   */
  @Get('live-photos-missing-video')
  async livePhotosMissingVideo(@Request() req: { user: User }) {
    const assets = await this.assetsService.findLivePhotosMissingVideo(req.user.id);
    return { assets };
  }

  @Get()
  async findAll(
    @Request() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('isLivePhoto') isLivePhoto?: string,
  ) {
    const liveFilter = isLivePhoto === 'true' ? true : undefined;
    const result = await this.assetsService.findAll(req.user.id, page, limit, liveFilter);
    return { ...result, assets: result.assets.map(serializeAsset) };
  }

  // --- Single asset endpoints ---

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: { user: User }) {
    const asset = await this.assetsService.findOne(id, req.user.id);
    return serializeAsset(asset);
  }

  @Patch(':id/location')
  async updateLocation(
    @Param('id') id: string,
    @Body('locationLat') locationLat: number,
    @Body('locationLng') locationLng: number,
    @Request() req: { user: User },
  ) {
    const asset = await this.assetsService.updateLocation(id, req.user.id, locationLat, locationLng);
    return serializeAsset(asset);
  }

  @Patch(':id/favorite')
  async toggleFavorite(@Param('id') id: string, @Request() req: { user: User }) {
    const asset = await this.assetsService.toggleFavorite(id, req.user.id);
    return serializeAsset(asset);
  }

  @Patch(':id/archive')
  async toggleArchive(@Param('id') id: string, @Request() req: { user: User }) {
    const asset = await this.assetsService.toggleArchive(id, req.user.id);
    return serializeAsset(asset);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async softDelete(@Param('id') id: string, @Request() req: { user: User }) {
    await this.assetsService.softDelete(id, req.user.id);
  }

  @Post(':id/restore')
  async restore(@Param('id') id: string, @Request() req: { user: User }) {
    const asset = await this.assetsService.restoreFromTrash(id, req.user.id);
    return serializeAsset(asset);
  }

  @Delete(':id/permanent')
  @HttpCode(HttpStatus.NO_CONTENT)
  async permanentDelete(@Param('id') id: string, @Request() req: { user: User }) {
    await this.assetsService.permanentDelete(id, req.user.id);
  }

  @Get(':id/jobs')
  async jobStatus(@Param('id') id: string, @Request() req: { user: User }) {
    return this.assetsService.getJobStatus(id, req.user.id);
  }

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Query('inline') inline: string | undefined,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const asset = await this.assetsService.findOne(id, req.user.id) as any;
    const isVideo = asset.type === 'VIDEO';
    const editedPath = asset.editedPath as string | null;
    const filePath: string = (isVideo && editedPath) ? editedPath : asset.originalPath;
    const contentType = (isVideo && editedPath) ? 'video/mp4' : (asset.mimeType || 'application/octet-stream');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    if (!inline) {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(asset.fileName)}"`);
    }

    const range = req.headers?.range as string | undefined;

    if (this.storage.isS3Key(filePath)) {
      const total = await this.storage.getObjectSize(filePath);
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
        const { stream } = await this.storage.getStreamRange(filePath, `bytes=${start}-${end}`);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', (end - start + 1).toString());
        await pipeline(Readable.from(stream), res as any);
      } else {
        res.setHeader('Content-Length', total.toString());
        const stream = await this.storage.getStream(filePath);
        await pipeline(Readable.from(stream), res as any);
      }
      return;
    }

    if (!filePath || !fs.existsSync(filePath)) throw new NotFoundException('File not found');
    const stat = fs.statSync(filePath);
    const total = stat.size;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', (end - start + 1).toString());
      await pipeline(fs.createReadStream(filePath, { start, end }), res as any);
    } else {
      res.setHeader('Content-Length', total.toString());
      await pipeline(fs.createReadStream(filePath), res as any);
    }
  }

  @Get(':id/thumbnail')
  async thumbnail(
    @Param('id') id: string,
    @Query('size') size: 'small' | 'large' = 'small',
    @Request() req: { user: User },
    @Res() res: Response,
  ) {
    const { filePath, mimeType } = await this.assetsService.serveThumbnail(id, req.user.id, size);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    if (this.storage.isS3Key(filePath)) {
      const stream = await this.storage.getStream(filePath);
      await pipeline(Readable.from(stream), res as any);
    } else {
      if (!fs.existsSync(filePath)) throw new NotFoundException('Thumbnail not found');
      await pipeline(fs.createReadStream(filePath), res as any);
    }
  }

  @Get(':id/stream/:file(*)')
  async stream(
    @Param('id') id: string,
    @Param('file') file: string,
    @Request() req: { user: User },
    @Res() res: Response,
  ) {
    await this.assetsService.findOne(id, req.user.id);
    // Prevent path traversal
    if (file.includes('..')) throw new NotFoundException('Invalid path');

    const ext = file.split('.').pop();
    const contentType =
      ext === 'm3u8' ? 'application/vnd.apple.mpegurl' :
      ext === 'ts'   ? 'video/mp2t' :
      'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    // No caching: playlists change after edits, segments regenerated with same filenames
    res.setHeader('Cache-Control', 'no-store');

    // Try S3 first (new uploads), fall back to local disk (legacy)
    const s3Key = `hls/${id}/${file}`;
    const localPath = join(this.assetsService.getHlsPath(id), file);
    try {
      const stream = await this.storage.getStream(s3Key);
      await pipeline(Readable.from(stream), res as any);
    } catch {
      if (!fs.existsSync(localPath)) throw new NotFoundException('Stream file not found');
      await pipeline(fs.createReadStream(localPath), res as any);
    }
  }

  // ─── Phase 5: Incremental sync ─────────────────────────────────────────────

  /**
   * POST /assets/check-hashes
   * Body: { checksums: string[] }
   * Returns: { missing: string[] }
   *
   * Used by the mobile client before starting a backup run. Send up to 500
   * SHA-256 checksums; get back the subset not yet in the library. Only those
   * files need uploading — everything else is already backed up.
   */
  @Post('check-hashes')
  async checkHashes(
    @Body() dto: CheckHashesDto,
    @Request() req: { user: User },
  ) {
    return this.assetsService.checkHashes(req.user.id, dto.checksums);
  }

  // ─── Phase 5: Resumable chunked uploads ────────────────────────────────────

  /**
   * POST /assets/upload-session
   * Create a new resumable upload session. Returns the sessionId and how many
   * bytes have already been received (non-zero when resuming a prior session).
   */
  @Post('upload-session')
  async createUploadSession(
    @Body() dto: CreateUploadSessionDto,
    @Request() req: { user: User },
  ) {
    return this.assetsService.createUploadSession(
      req.user.id,
      dto.checksum,
      dto.fileName,
      dto.fileSize,
      dto.mimeType,
      dto.deviceAssetId,
    );
  }

  /**
   * POST /assets/upload-session/:id/chunk
   * Upload one chunk. Pass the byte offset as the `X-Chunk-Offset` header and
   * the raw bytes as `multipart/form-data` field named `chunk`.
   */
  @Post('upload-session/:id/chunk')
  @UseInterceptors(FileInterceptor('chunk', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadChunk(
    @Param('id') sessionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Request() req: { user: User },
  ) {
    if (!file) throw new NotFoundException('No chunk provided');
    return this.assetsService.uploadChunk(req.user.id, sessionId, offset, file.buffer);
  }

  /**
   * POST /assets/upload-session/:id/complete
   * Assemble all received chunks, verify the SHA-256, and hand the file off to
   * the normal processing pipeline (thumbnails, EXIF, ML jobs).
   */
  @Post('upload-session/:id/complete')
  async completeUploadSession(
    @Param('id') sessionId: string,
    @Body('fileCreatedAt') fileCreatedAt: string | undefined,
    @Body('deviceAssetId') deviceAssetId: string | undefined,
    @Request() req: { user: User },
  ) {
    const asset = await this.assetsService.completeUploadSession(
      req.user.id,
      sessionId,
      fileCreatedAt,
      deviceAssetId,
    );
    return serializeAsset(asset);
  }

  // ─── Phase 5: Live Photo / Motion Photo ────────────────────────────────────

  // ─── Photo / Video Editing ─────────────────────────────────────────────────

  /**
   * POST /assets/:id/edit/preview
   * Apply edit parameters on-the-fly and stream the result back as JPEG.
   * Nothing is persisted; use this for live preview while the user tweaks sliders.
   */
  @Post(':id/edit/preview')
  async editPreview(
    @Param('id') id: string,
    @Body() dto: EditAssetDto,
    @Request() req: { user: User },
    @Res() res: Response,
  ) {
    const { buffer, mimeType } = await this.editService.previewEdit(id, req.user.id, dto);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'no-store');
    (res as any).send(buffer);
  }

  /**
   * POST /assets/:id/edit/save
   * Apply edits and save the result permanently (editedPath + editParams in DB).
   * Returns the updated asset record.
   */
  @Post(':id/edit/save')
  async editSave(
    @Param('id') id: string,
    @Body() dto: EditAssetDto,
    @Request() req: { user: User },
  ) {
    const asset = await this.editService.saveEdit(id, req.user.id, dto);
    return serializeAsset(asset);
  }

  /**
   * GET /assets/:id/crop-preview
   * Returns the original image resized to max 1080 px with only rotation applied.
   * The crop screen uses this so coordinates are always relative to the original image.
   */
  @Get(':id/crop-preview')
  async cropPreview(
    @Param('id') id: string,
    @Request() req: { user: User },
    @Res() res: Response,
  ) {
    const { buffer, mimeType } = await this.editService.getCropPreview(id, req.user.id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    (res as any).send(buffer);
  }

  /**
   * GET /assets/:id/edited
   * Stream the saved edited version of the asset (if editedPath is set).
   */
  @Get(':id/edited')
  async getEdited(
    @Param('id') id: string,
    @Request() req: { user: User },
    @Res() res: Response,
  ) {
    const { filePath, mimeType } = await this.editService.getEditedImage(id, req.user.id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (this.storage.isS3Key(filePath)) {
      const stream = await this.storage.getStream(filePath);
      await pipeline(Readable.from(stream), res as any);
    } else {
      if (!fs.existsSync(filePath)) throw new NotFoundException('Edited image not found');
      await pipeline(fs.createReadStream(filePath), res as any);
    }
  }

  /**
   * DELETE /assets/:id/edit
   * Revert to original: clears editedPath and editParams from the DB,
   * and deletes the stored edited image from S3.
   */
  @Delete(':id/edit')
  async revertEdit(
    @Param('id') id: string,
    @Request() req: { user: User },
  ) {
    const asset = await this.editService.revertEdit(id, req.user.id);
    return serializeAsset(asset);
  }

  /**
   * GET /assets/:id/live-video
   * Stream the companion MOV/MP4 for a Live Photo asset.
   */
  @Get(':id/live-video')
  async getLiveVideo(
    @Param('id') id: string,
    @Request() req: { user: User },
    @Res() res: Response,
  ) {
    const asset = await this.assetsService.findOne(id, req.user.id);
    const videoPath = (asset as any).livePhotoVideoPath as string | null;
    if (!videoPath) throw new NotFoundException('Live photo video not found');
    res.setHeader('Content-Type', 'video/quicktime');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (this.storage.isS3Key(videoPath)) {
      const stream = await this.storage.getStream(videoPath);
      await pipeline(Readable.from(stream), res as any);
    } else {
      if (!fs.existsSync(videoPath)) throw new NotFoundException('Live photo video file not found');
      await pipeline(fs.createReadStream(videoPath), res as any);
    }
  }

  /**
   * POST /assets/:id/live-video
   * Attach the MOV/MP4 companion video to an existing image asset, marking it
   * as a Live Photo. Call this after the HEIC/JPEG is already uploaded.
   */
  @Post(':id/live-video')
  @UseInterceptors(FileInterceptor('file', { storage: liveVideoStorage, limits: { fileSize: 50 * 1024 * 1024 } }))
  async attachLiveVideo(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: { user: User },
  ) {
    if (!file) throw new NotFoundException('No video file provided');
    const asset = await this.assetsService.attachLivePhotoVideo(id, req.user.id, file);
    return serializeAsset(asset);
  }

  @Post(':id/live-video-error')
  async reportLiveVideoError(
    @Param('id') id: string,
    @Body() body: { code: string; message: string },
    @Request() req: { user: User },
  ) {
    console.warn('[LivePhoto] extraction error for asset ' + id + ': ' + body.code + ' — ' + body.message);
    return { received: true };
  }
}
