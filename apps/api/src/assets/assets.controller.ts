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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AssetsService } from './assets.service';
import { UploadAssetDto } from './dto/upload-asset.dto';
import { User } from '@prisma/client';
import * as fs from 'fs';

const uploadStorage = diskStorage({
  destination: process.env.UPLOAD_PATH || '/uploads',
  filename: (_req, file, cb) => {
    cb(null, `${uuidv4()}${extname(file.originalname)}`);
  },
});

function serializeAsset(a: any) {
  return { ...a, fileSizeBytes: a.fileSizeBytes.toString() };
}

@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

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

  @Get('trashed')
  async trashed(
    @Request() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const result = await this.assetsService.findTrashed(req.user.id, page, limit);
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

  @Get(':id/thumbnail')
  async thumbnail(
    @Param('id') id: string,
    @Query('size') size: 'small' | 'large' = 'small',
    @Request() req: { user: User },
    @Res() res: Response,
  ) {
    const { filePath, mimeType } = await this.assetsService.serveThumbnail(id, req.user.id, size);
    if (!fs.existsSync(filePath)) throw new NotFoundException('File not found on disk');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    fs.createReadStream(filePath).pipe(res);
  }

  @Get(':id/stream/:file(*)')
  async stream(
    @Param('id') id: string,
    @Param('file') file: string,
    @Request() req: { user: User },
    @Res() res: Response,
  ) {
    await this.assetsService.findOne(id, req.user.id);
    const hlsDir = this.assetsService.getHlsPath(id);
    const filePath = join(hlsDir, file);
    if (!filePath.startsWith(hlsDir) || !fs.existsSync(filePath)) {
      throw new NotFoundException('Stream file not found');
    }
    const ext = file.split('.').pop();
    const contentType =
      ext === 'm3u8' ? 'application/vnd.apple.mpegurl' :
      ext === 'ts'   ? 'video/mp2t' :
      'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  }
}
