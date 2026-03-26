import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { CreateAlbumDto } from './dto/create-album.dto';
import { UpdateAlbumDto } from './dto/update-album.dto';
import { AddAssetsDto } from './dto/add-assets.dto';

@Injectable()
export class AlbumsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, dto: CreateAlbumDto) {
    return this.prisma.album.create({
      data: { id: uuidv4(), ownerId, name: dto.name, description: dto.description },
      include: { _count: { select: { assets: true } } },
    });
  }

  async findAll(ownerId: string) {
    return this.prisma.album.findMany({
      where: { ownerId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { assets: true } } },
    });
  }

  async findOne(id: string, ownerId: string) {
    const album = await this.prisma.album.findUnique({
      where: { id },
      include: {
        _count: { select: { assets: true } },
        assets: {
          orderBy: { addedAt: 'desc' },
          include: { asset: true },
        },
      },
    });
    if (!album) throw new NotFoundException('Album not found');
    if (album.ownerId !== ownerId) throw new ForbiddenException('Access denied');
    return album;
  }

  async update(id: string, ownerId: string, dto: UpdateAlbumDto) {
    const album = await this.findOne(id, ownerId);

    if (dto.coverAssetId) {
      const inAlbum = album.assets.some((aa) => aa.assetId === dto.coverAssetId);
      if (!inAlbum) throw new BadRequestException('Cover asset must be in the album');
    }

    return this.prisma.album.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        coverAssetId: dto.coverAssetId,
      },
      include: { _count: { select: { assets: true } } },
    });
  }

  async remove(id: string, ownerId: string) {
    const album = await this.prisma.album.findUnique({ where: { id } });
    if (!album) throw new NotFoundException('Album not found');
    if (album.ownerId !== ownerId) throw new ForbiddenException('Access denied');
    await this.prisma.album.delete({ where: { id } });
  }

  async addAssets(albumId: string, ownerId: string, dto: AddAssetsDto) {
    await this.findOne(albumId, ownerId);

    // Verify all assets belong to this user
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: dto.assetIds }, ownerId, isDeleted: false },
      select: { id: true },
    });
    if (assets.length !== dto.assetIds.length) {
      throw new BadRequestException('One or more assets not found or not owned by you');
    }

    await this.prisma.albumAsset.createMany({
      data: dto.assetIds.map((assetId) => ({ albumId, assetId })),
      skipDuplicates: true,
    });

    await this.prisma.album.update({ where: { id: albumId }, data: { updatedAt: new Date() } });

    return this.findOne(albumId, ownerId);
  }

  async removeAssets(albumId: string, ownerId: string, dto: AddAssetsDto) {
    await this.findOne(albumId, ownerId);

    await this.prisma.albumAsset.deleteMany({
      where: { albumId, assetId: { in: dto.assetIds } },
    });

    await this.prisma.album.update({ where: { id: albumId }, data: { updatedAt: new Date() } });

    return this.findOne(albumId, ownerId);
  }
}
