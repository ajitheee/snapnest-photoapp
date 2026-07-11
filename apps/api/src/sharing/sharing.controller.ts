import {
  Controller, Get, Post, Delete,
  Param, Body, Query, Request, UseGuards, HttpCode, HttpStatus, Res, NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SharingService } from './sharing.service';
import { SharingSuggestionsService } from './sharing-suggestions.service';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { StorageService } from '../storage/storage.service';
import { User } from '@prisma/client';
import { Response } from 'express';
import * as fs from 'fs';

function serializeAsset(a: any) {
  if (!a) return a;
  return { ...a, fileSizeBytes: a.fileSizeBytes?.toString() };
}

function serializePublicLink(link: any) {
  if (!link) return link;
  const result = { ...link };
  if (result.asset) result.asset = serializeAsset(result.asset);
  if (result.album?.assets) {
    result.album = {
      ...result.album,
      assets: result.album.assets.map((aa: any) => ({
        ...aa,
        asset: serializeAsset(aa.asset),
      })),
    };
  }
  return result;
}

@Controller('sharing')
@UseGuards(JwtAuthGuard)
export class SharingController {
  constructor(
    private readonly sharingService: SharingService,
    private readonly suggestionsService: SharingSuggestionsService,
  ) {}

  @Post()
  create(@Body() dto: CreateShareLinkDto, @Request() req: { user: User }) {
    return this.sharingService.create(req.user.id, dto);
  }

  @Get()
  findAll(@Request() req: { user: User }) {
    return this.sharingService.findAll(req.user.id);
  }

  @Get('suggestions/people')
  getSuggestions(@Request() req: { user: User }) {
    return this.suggestionsService.getSuggestions(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: { user: User }) {
    return this.sharingService.findOne(id, req.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Request() req: { user: User }) {
    return this.sharingService.remove(id, req.user.id);
  }
}

@Controller('s')
export class PublicShareController {
  constructor(
    private readonly sharingService: SharingService,
    private readonly storage: StorageService,
  ) {}

  @Get(':token')
  async resolve(
    @Param('token') token: string,
    @Query('password') password?: string,
  ) {
    const link = await this.sharingService.resolvePublicLink(token, password);
    return serializePublicLink(link);
  }

  @Get(':token/thumbnail/:assetId')
  async thumbnail(
    @Param('token') token: string,
    @Param('assetId') assetId: string,
    @Query('size') size: 'small' | 'large' = 'small',
    @Res() res: Response,
  ) {
    const { filePath, mimeType } = await this.sharingService.getPublicFile(token, assetId, size);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (this.storage.isS3Key(filePath)) {
      const stream = await this.storage.getStream(filePath);
      stream.pipe(res);
    } else {
      if (!fs.existsSync(filePath)) throw new NotFoundException('File not found');
      fs.createReadStream(filePath).pipe(res);
    }
  }

  @Get(':token/photo/:assetId')
  async fullPhoto(
    @Param('token') token: string,
    @Param('assetId') assetId: string,
    @Res() res: Response,
  ) {
    const { filePath, mimeType } = await this.sharingService.getPublicFile(token, assetId, 'original');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (this.storage.isS3Key(filePath)) {
      const stream = await this.storage.getStream(filePath);
      stream.pipe(res);
    } else {
      if (!fs.existsSync(filePath)) throw new NotFoundException('File not found');
      fs.createReadStream(filePath).pipe(res);
    }
  }
}
