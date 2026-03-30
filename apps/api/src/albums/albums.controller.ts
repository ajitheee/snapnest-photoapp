import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Request, UseGuards, HttpCode, HttpStatus, Res, NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const archiver = require('archiver');
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AlbumsService } from './albums.service';
import { SmartAlbumsService } from './smart-albums.service';
import { CreateAlbumDto } from './dto/create-album.dto';
import { UpdateAlbumDto } from './dto/update-album.dto';
import { AddAssetsDto } from './dto/add-assets.dto';
import { User } from '@prisma/client';

function serializeAlbum(album: any) {
  if (!album) return album;
  if (!album.assets) return album;
  return {
    ...album,
    assets: album.assets.map((aa: any) => ({
      ...aa,
      asset: aa.asset ? { ...aa.asset, fileSizeBytes: aa.asset.fileSizeBytes?.toString() } : aa.asset,
    })),
  };
}

@Controller('albums')
@UseGuards(JwtAuthGuard)
export class AlbumsController {
  constructor(
    private readonly albumsService: AlbumsService,
    private readonly smartAlbumsService: SmartAlbumsService,
  ) {}

  @Get('smart')
  getSmartAlbums(@Request() req: { user: User }) {
    return this.smartAlbumsService.getSmartAlbums(req.user.id);
  }

  @Post()
  create(@Body() dto: CreateAlbumDto, @Request() req: { user: User }) {
    return this.albumsService.create(req.user.id, dto);
  }

  @Get()
  findAll(@Request() req: { user: User }) {
    return this.albumsService.findAll(req.user.id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: { user: User }) {
    const album = await this.albumsService.findOne(id, req.user.id);
    return serializeAlbum(album);
  }

  @Get(':id/download')
  async downloadAlbum(
    @Param('id') id: string,
    @Request() req: { user: User },
    @Res() res: Response,
  ) {
    const album = await this.albumsService.findOne(id, req.user.id);
    if (!album) throw new NotFoundException('Album not found');
    const assets = (album as any).assets || [];
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent((album as any).name)}.zip"`);
    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);
    for (const aa of assets) {
      const asset = aa.asset;
      if (asset?.originalPath && fs.existsSync(asset.originalPath)) {
        archive.file(asset.originalPath, { name: asset.fileName });
      }
    }
    await archive.finalize();
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAlbumDto, @Request() req: { user: User }) {
    const album = await this.albumsService.update(id, req.user.id, dto);
    return serializeAlbum(album);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Request() req: { user: User }) {
    return this.albumsService.remove(id, req.user.id);
  }

  @Post(':id/assets')
  async addAssets(@Param('id') id: string, @Body() dto: AddAssetsDto, @Request() req: { user: User }) {
    const album = await this.albumsService.addAssets(id, req.user.id, dto);
    return serializeAlbum(album);
  }

  @Delete(':id/assets')
  @HttpCode(HttpStatus.OK)
  async removeAssets(@Param('id') id: string, @Body() dto: AddAssetsDto, @Request() req: { user: User }) {
    const album = await this.albumsService.removeAssets(id, req.user.id, dto);
    return serializeAlbum(album);
  }
}
