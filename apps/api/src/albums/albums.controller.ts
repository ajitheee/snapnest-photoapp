import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Request, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AlbumsService } from './albums.service';
import { CreateAlbumDto } from './dto/create-album.dto';
import { UpdateAlbumDto } from './dto/update-album.dto';
import { AddAssetsDto } from './dto/add-assets.dto';
import { User } from '@prisma/client';

@Controller('albums')
@UseGuards(JwtAuthGuard)
export class AlbumsController {
  constructor(private readonly albumsService: AlbumsService) {}

  @Post()
  create(@Body() dto: CreateAlbumDto, @Request() req: { user: User }) {
    return this.albumsService.create(req.user.id, dto);
  }

  @Get()
  findAll(@Request() req: { user: User }) {
    return this.albumsService.findAll(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: { user: User }) {
    return this.albumsService.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAlbumDto, @Request() req: { user: User }) {
    return this.albumsService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Request() req: { user: User }) {
    return this.albumsService.remove(id, req.user.id);
  }

  @Post(':id/assets')
  addAssets(@Param('id') id: string, @Body() dto: AddAssetsDto, @Request() req: { user: User }) {
    return this.albumsService.addAssets(id, req.user.id, dto);
  }

  @Delete(':id/assets')
  @HttpCode(HttpStatus.OK)
  removeAssets(@Param('id') id: string, @Body() dto: AddAssetsDto, @Request() req: { user: User }) {
    return this.albumsService.removeAssets(id, req.user.id, dto);
  }
}
