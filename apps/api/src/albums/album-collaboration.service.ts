import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AlbumCollaborationService {
  constructor(private readonly prisma: PrismaService) {}

  async addComment(albumId: string, userId: string, userName: string, text: string, assetId?: string) {
    await this.verifyAccess(albumId, userId);
    const comment = await this.prisma.albumComment.create({
      data: { albumId, userId, userName, text, assetId },
    });
    await this.prisma.albumActivity.create({
      data: { albumId, userId, userName, action: 'comment', assetId, text },
    });
    return comment;
  }

  async getComments(albumId: string, userId: string) {
    await this.verifyAccess(albumId, userId);
    return this.prisma.albumComment.findMany({
      where: { albumId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async deleteComment(commentId: string, userId: string) {
    const comment = await this.prisma.albumComment.findUnique({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId) throw new ForbiddenException('Not your comment');
    return this.prisma.albumComment.delete({ where: { id: commentId } });
  }

  async toggleLike(albumId: string, assetId: string, userId: string, userName: string) {
    await this.verifyAccess(albumId, userId);
    const existing = await this.prisma.albumLike.findUnique({
      where: { albumId_assetId_userId: { albumId, assetId, userId } },
    });
    if (existing) {
      await this.prisma.albumLike.delete({ where: { id: existing.id } });
      return { liked: false };
    }
    await this.prisma.albumLike.create({
      data: { albumId, assetId, userId, userName },
    });
    await this.prisma.albumActivity.create({
      data: { albumId, userId, userName, action: 'like', assetId },
    });
    return { liked: true };
  }

  async getLikes(albumId: string, userId: string) {
    await this.verifyAccess(albumId, userId);
    return this.prisma.albumLike.findMany({
      where: { albumId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getActivity(albumId: string, userId: string, limit = 50) {
    await this.verifyAccess(albumId, userId);
    return this.prisma.albumActivity.findMany({
      where: { albumId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async contributeAsset(albumId: string, assetId: string, userId: string, userName: string) {
    const album = await this.prisma.album.findUnique({ where: { id: albumId } });
    if (!album) throw new NotFoundException('Album not found');
    if (!album.allowContributions && album.ownerId !== userId) {
      throw new ForbiddenException('This album does not accept contributions');
    }
    await this.verifyAccess(albumId, userId);

    await this.prisma.albumAsset.create({
      data: { albumId, assetId },
    }).catch(() => {});

    await this.prisma.albumActivity.create({
      data: { albumId, userId, userName, action: 'add_photo', assetId },
    });
    return { added: true };
  }

  private async verifyAccess(albumId: string, userId: string) {
    const album = await this.prisma.album.findUnique({ where: { id: albumId } });
    if (!album) throw new NotFoundException('Album not found');
    if (album.ownerId === userId) return;
    const share = await this.prisma.albumShare.findFirst({
      where: { albumId, sharedWithId: userId },
    });
    if (!share) throw new ForbiddenException('No access to this album');
  }
}
