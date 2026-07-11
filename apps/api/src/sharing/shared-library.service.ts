import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SharedLibraryService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, name: string, memberEmails: string[], rules?: any) {
    const library = await this.prisma.sharedLibrary.create({
      data: {
        name,
        ownerId,
        rules,
        members: {
          create: [{ userId: ownerId, role: 'owner' }],
        },
      },
    });

    for (const email of memberEmails) {
      const user = await this.prisma.user.findUnique({ where: { email } });
      if (user && user.id !== ownerId) {
        await this.prisma.sharedLibraryMember.create({
          data: { sharedLibraryId: library.id, userId: user.id, role: 'member' },
        }).catch(() => {});
      }
    }

    return library;
  }

  async getMyLibraries(userId: string) {
    const memberships = await this.prisma.sharedLibraryMember.findMany({
      where: { userId },
      include: {
        sharedLibrary: {
          include: {
            members: { select: { userId: true, role: true } },
          },
        },
      },
    });
    return memberships.map(m => ({
      ...m.sharedLibrary,
      myRole: m.role,
    }));
  }

  async getLibraryAssets(libraryId: string, userId: string, page = 1, limit = 50) {
    await this.verifyMember(libraryId, userId);

    const library = await this.prisma.sharedLibrary.findUnique({
      where: { id: libraryId },
      include: { members: true },
    });
    if (!library) throw new NotFoundException();

    const memberIds = library.members.map(m => m.userId);
    const skip = (page - 1) * limit;

    const [assets, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({
        where: { ownerId: { in: memberIds }, isDeleted: false, isArchived: false },
        orderBy: { fileCreatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.asset.count({
        where: { ownerId: { in: memberIds }, isDeleted: false, isArchived: false },
      }),
    ]);

    return { assets: assets.map(a => ({ ...a, fileSizeBytes: a.fileSizeBytes.toString() })), total, page, limit };
  }

  async addMember(libraryId: string, ownerId: string, email: string) {
    const library = await this.prisma.sharedLibrary.findUnique({ where: { id: libraryId } });
    if (!library || library.ownerId !== ownerId) throw new ForbiddenException();

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.sharedLibraryMember.create({
      data: { sharedLibraryId: libraryId, userId: user.id },
    });
  }

  async removeMember(libraryId: string, ownerId: string, memberId: string) {
    const library = await this.prisma.sharedLibrary.findUnique({ where: { id: libraryId } });
    if (!library || library.ownerId !== ownerId) throw new ForbiddenException();

    await this.prisma.sharedLibraryMember.deleteMany({
      where: { sharedLibraryId: libraryId, userId: memberId },
    });
    return { removed: true };
  }

  async deleteLibrary(libraryId: string, ownerId: string) {
    const library = await this.prisma.sharedLibrary.findUnique({ where: { id: libraryId } });
    if (!library || library.ownerId !== ownerId) throw new ForbiddenException();
    await this.prisma.sharedLibrary.delete({ where: { id: libraryId } });
    return { deleted: true };
  }

  private async verifyMember(libraryId: string, userId: string) {
    const member = await this.prisma.sharedLibraryMember.findUnique({
      where: { sharedLibraryId_userId: { sharedLibraryId: libraryId, userId } },
    });
    if (!member) throw new ForbiddenException('Not a member of this library');
  }
}
