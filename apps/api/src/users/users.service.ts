import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';

export interface UserPreferences {
  assetViewer: {
    loadPreviewImage: boolean;
    loadOriginalImage: boolean;
  };
  videos: {
    autoPlay: boolean;
    looping: boolean;
  };
  theme: {
    automatic: boolean;
    primaryColor: string | null;
    colorfulInterface: boolean;
  };
  photoGrid: {
    showStorageIndicator: boolean;
    assetsPerRow: number;
  };
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  assetViewer: {
    loadPreviewImage: true,
    loadOriginalImage: false,
  },
  videos: {
    autoPlay: true,
    looping: false,
  },
  theme: {
    automatic: false,
    primaryColor: null,
    colorfulInterface: false,
  },
  photoGrid: {
    showStorageIndicator: true,
    assetsPerRow: 4,
  },
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async create(data: {
    email: string;
    passwordHash: string | null;
    name: string;
  }): Promise<User> {
    return this.prisma.user.create({ data });
  }

  async getPreferences(userId: string): Promise<UserPreferences> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } });
    const stored = user?.preferences as Partial<UserPreferences> | null;
    return this.mergeWithDefaults(stored);
  }

  async updatePreferences(userId: string, patch: Partial<UserPreferences>): Promise<UserPreferences> {
    const current = await this.getPreferences(userId);
    const merged: UserPreferences = {
      assetViewer: { ...current.assetViewer, ...(patch.assetViewer ?? {}) },
      videos: { ...current.videos, ...(patch.videos ?? {}) },
      theme: { ...current.theme, ...(patch.theme ?? {}) },
      photoGrid: { ...current.photoGrid, ...(patch.photoGrid ?? {}) },
    };
    await this.prisma.user.update({ where: { id: userId }, data: { preferences: merged as any } });
    return merged;
  }

  private mergeWithDefaults(stored: Partial<UserPreferences> | null): UserPreferences {
    if (!stored) return { ...DEFAULT_PREFERENCES };
    return {
      assetViewer: { ...DEFAULT_PREFERENCES.assetViewer, ...(stored.assetViewer ?? {}) },
      videos: { ...DEFAULT_PREFERENCES.videos, ...(stored.videos ?? {}) },
      theme: { ...DEFAULT_PREFERENCES.theme, ...(stored.theme ?? {}) },
      photoGrid: { ...DEFAULT_PREFERENCES.photoGrid, ...(stored.photoGrid ?? {}) },
    };
  }
}
