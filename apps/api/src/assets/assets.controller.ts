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
import { StorageService } from '../storage/storage.service';
import { UploadAssetDto } from './dto/upload-asset.dto';
import { CheckHashesDto } from './dto/check-hashes.dto';
import { CreateUploadSessionDto } from './dto/create-upload-session.dto';
import { User } from '@prisma/client';
import * as fs from 'fs';

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
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage, limits: { fileSize: 500 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadAssetDto,
    @Request() req: { user: User },
  ) {
    if (!file) throw new NotFoundException('No file provided');
    const asset = await this.assetsService.uploadAsset(req.user.id, file, dto.fileCreatedAt);
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

  @Get()
  async findAll(
    @Request() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const result = await this.assetsService.findAll(req.user.id, page, limit);
    return { ...result, assets: result.assets.map(serializeAsset) };
  }

  // --- Single asset endpoints ---

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: { user: User }) {
    const asset = await this.assetsService.findOne(id, req.user.id);
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
    @Request() req: { user: any },
    @Res() res: Response,
  ) {
    const asset = await this.assetsService.findOne(id, req.user.id) as any;
    const filePath: string = asset.originalPath;
    res.setHeader('Content-Type', asset.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(asset.fileName)}"`);
    res.setHeader('Content-Length', asset.fileSizeBytes.toString());
    if (this.storage.isS3Key(filePath)) {
      const stream = await this.storage.getStream(filePath);
      stream.pipe(res as any);
    } else {
      if (!filePath || !fs.existsSync(filePath)) throw new NotFoundException('File not found');
      fs.createReadStream(filePath).pipe(res as any);
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
      stream.pipe(res as any);
    } else {
      if (!fs.existsSync(filePath)) throw new NotFoundException('Thumbnail not found');
      fs.createReadStream(filePath).pipe(res as any);
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
    res.setHeader('Cache-Control', 'private, max-age=3600');

    // Try S3 first (new uploads), fall back to local disk (legacy)
    const s3Key = `hls/${id}/${file}`;
    const localPath = join(this.assetsService.getHlsPath(id), file);
    try {
      const stream = await this.storage.getStream(s3Key);
      stream.pipe(res as any);
    } catch {
      if (!fs.existsSync(localPath)) throw new NotFoundException('Stream file not found');
      fs.createReadStream(localPath).pipe(res as any);
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
    const missing = await this.assetsService.checkHashes(req.user.id, dto.checksums);
    return { missing };
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
}
