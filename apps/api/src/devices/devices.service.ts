import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DevicePlatform } from '@prisma/client';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Register (or refresh) a push notification token for a user's device. */
  async register(
    userId: string,
    token: string,
    platform: DevicePlatform,
    appVersion?: string,
  ) {
    return this.prisma.deviceToken.upsert({
      where: { token },
      update: { userId, platform, appVersion, updatedAt: new Date() },
      create: { userId, token, platform, appVersion },
    });
  }

  /** Unregister a specific token (e.g. on logout or app uninstall). */
  async unregister(userId: string, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token, userId } });
  }

  /** Return all active FCM/APNs tokens for a user (used by NotificationsService). */
  async getTokensForUser(userId: string): Promise<string[]> {
    const records = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
    return records.map((r) => r.token);
  }

  /** Remove a stale token that the push provider reported as invalid. */
  async removeStaleToken(token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token } });
  }
}
