import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnauthorizedException,
  GoneException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class SharingService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, dto: CreateShareLinkDto) {
    if (!dto.albumId && !dto.assetId) {
      throw new BadRequestException('Provide either albumId or assetId');
    }

    if (dto.albumId) {
      const album = await this.prisma.album.findUnique({ where: { id: dto.albumId } });
      if (!album || album.ownerId !== ownerId) throw new ForbiddenException('Album not found');
    }

    if (dto.assetId) {
      const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } });
      if (!asset || asset.ownerId !== ownerId || asset.isDeleted) {
        throw new ForbiddenException('Asset not found');
      }
    }

    const token = crypto.randomBytes(18).toString('base64url');
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 10) : undefined;

    return this.prisma.shareLink.create({
      data: {
        id: uuidv4(),
        token,
        ownerId,
        albumId: dto.albumId,
        assetId: dto.assetId,
        passwordHash,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });
  }

  async findAll(ownerId: string) {
    return this.prisma.shareLink.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      include: {
        album: { select: { id: true, name: true } },
        asset: { select: { id: true, fileName: true } },
      },
    });
  }

  async findOne(id: string, ownerId: string) {
    const link = await this.prisma.shareLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('Share link not found');
    if (link.ownerId !== ownerId) throw new ForbiddenException('Access denied');
    return link;
  }

  async remove(id: string, ownerId: string) {
    await this.findOne(id, ownerId);
    await this.prisma.shareLink.delete({ where: { id } });
  }

  async resolvePublicLink(token: string, password?: string) {
    const link = await this.prisma.shareLink.findUnique({
      where: { token },
      include: {
        album: {
          include: {
            assets: {
              include: { asset: true },
              orderBy: { addedAt: 'desc' },
            },
          },
        },
        asset: true,
      },
    });

    if (!link) throw new NotFoundException('Share link not found');

    if (link.expiresAt && link.expiresAt < new Date()) {
      throw new GoneException('This share link has expired');
    }

    if (link.passwordHash) {
      if (!password) throw new UnauthorizedException('Password required');
      const valid = await bcrypt.compare(password, link.passwordHash);
      if (!valid) throw new UnauthorizedException('Incorrect password');
    }

    await this.prisma.shareLink.update({
      where: { id: link.id },
      data: { viewCount: { increment: 1 } },
    });

    const { passwordHash, ...publicLink } = link as any;
    return publicLink;
  }
}
