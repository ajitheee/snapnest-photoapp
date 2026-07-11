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
        _count: { select: { assets: { where: { asset: { isDeleted: false } } } } },
        assets: {
          where: { asset: { isDeleted: false } },
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

  // ── Album Sharing (email-based) ────────────────────────────────────────────

  /** Share album with a user by email. Idempotent — does nothing if already shared. */
  async shareWithEmail(albumId: string, ownerId: string, email: string) {
    const album = await this.prisma.album.findUnique({ where: { id: albumId } });
    if (!album) throw new NotFoundException('Album not found');
    if (album.ownerId !== ownerId) throw new ForbiddenException('Access denied');

    // Look up target user (may not have an account yet — share by email only)
    const targetUser = await this.prisma.user.findUnique({ where: { email } });

    await (this.prisma as any).albumShare.upsert({
      where: { albumId_sharedWithEmail: { albumId, sharedWithEmail: email } },
      create: {
        albumId,
        ownerId,
        sharedWithEmail: email,
        sharedWithId: targetUser?.id ?? null,
      },
      update: { sharedWithId: targetUser?.id ?? null },
    });

    return { albumId, email, shared: true };
  }

  /** Remove a previously shared email from an album. */
  async unshareWithEmail(albumId: string, ownerId: string, email: string) {
    const album = await this.prisma.album.findUnique({ where: { id: albumId } });
    if (!album) throw new NotFoundException('Album not found');
    if (album.ownerId !== ownerId) throw new ForbiddenException('Access denied');

    await (this.prisma as any).albumShare.deleteMany({
      where: { albumId, sharedWithEmail: email },
    });
    return { albumId, email, shared: false };
  }

  /** Return all albums shared with the requesting user (by their email). */
  async findSharedWithMe(userEmail: string) {
    const shares = await (this.prisma as any).albumShare.findMany({
      where: { sharedWithEmail: userEmail },
      include: {
        album: {
          include: { _count: { select: { assets: true } } },
        },
        owner: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return shares.map((s: any) => ({
      ...s.album,
      isOwned: false,
      sharedByName: s.owner.name,
      sharedByEmail: s.owner.email,
    }));
  }

  /** List emails this album has been shared with. */
  async getShareList(albumId: string, ownerId: string) {
    const album = await this.prisma.album.findUnique({ where: { id: albumId } });
    if (!album) throw new NotFoundException('Album not found');
    if (album.ownerId !== ownerId) throw new ForbiddenException('Access denied');

    return (this.prisma as any).albumShare.findMany({
      where: { albumId },
      select: { sharedWithEmail: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Album Folders & Sorting ────────────────────────────────────────────────

  async createFolder(ownerId: string, name: string, parentId?: string) {
    return (this.prisma as any).albumFolder.create({
      data: { ownerId, name, parentId: parentId || null },
    });
  }

  async listFolders(ownerId: string) {
    return (this.prisma as any).albumFolder.findMany({
      where: { ownerId },
      include: { albums: { include: { _count: { select: { assets: true } } } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async updateFolder(id: string, ownerId: string, data: { name?: string; parentId?: string | null; sortOrder?: number }) {
    const folder = await (this.prisma as any).albumFolder.findUnique({ where: { id } });
    if (!folder) throw new NotFoundException('Folder not found');
    if (folder.ownerId !== ownerId) throw new ForbiddenException('Access denied');
    return (this.prisma as any).albumFolder.update({ where: { id }, data });
  }

  async deleteFolder(id: string, ownerId: string) {
    const folder = await (this.prisma as any).albumFolder.findUnique({ where: { id } });
    if (!folder) throw new NotFoundException('Folder not found');
    if (folder.ownerId !== ownerId) throw new ForbiddenException('Access denied');
    await this.prisma.album.updateMany({ where: { folderId: id }, data: { folderId: null } });
    await (this.prisma as any).albumFolder.delete({ where: { id } });
  }

  async moveAlbumToFolder(albumId: string, ownerId: string, folderId: string | null) {
    const album = await this.prisma.album.findUnique({ where: { id: albumId } });
    if (!album) throw new NotFoundException('Album not found');
    if (album.ownerId !== ownerId) throw new ForbiddenException('Access denied');
    return this.prisma.album.update({ where: { id: albumId }, data: { folderId } });
  }

  async updateAlbumSortOrder(albumId: string, ownerId: string, sortOrder: number) {
    const album = await this.prisma.album.findUnique({ where: { id: albumId } });
    if (!album) throw new NotFoundException('Album not found');
    if (album.ownerId !== ownerId) throw new ForbiddenException('Access denied');
    return this.prisma.album.update({ where: { id: albumId }, data: { sortOrder } });
  }

  async findAllWithFolders(ownerId: string) {
    const [folders, albums] = await Promise.all([
      (this.prisma as any).albumFolder.findMany({
        where: { ownerId },
        include: {
          albums: { include: { _count: { select: { assets: true } } }, orderBy: { sortOrder: 'asc' } },
          children: { orderBy: { sortOrder: 'asc' } },
        },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.album.findMany({
        where: { ownerId, folderId: null },
        include: { _count: { select: { assets: true } } },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    return { folders, albums };
  }
}
