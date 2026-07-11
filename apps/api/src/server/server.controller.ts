import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';

const APP_VERSION = process.env.npm_package_version || '1.0.0';

@Controller('server')
export class ServerController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  async getHealth() {
    let dbStatus = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }

    const status = dbStatus === 'ok' ? 'ok' : 'degraded';
    return { status, version: APP_VERSION, database: dbStatus };
  }

  @Get('info')
  @UseGuards(JwtAuthGuard)
  async getInfo(@Request() req: { user: User }) {
    // Sum storage used across all users (server-wide total)
    const agg = await this.prisma.asset.aggregate({
      where: { isDeleted: false },
      _sum: { fileSizeBytes: true },
    });

    const storageUsedBytes = Number(agg._sum.fileSizeBytes ?? 0);

    return {
      version: APP_VERSION,
      // Expose as integer-compatible number (JS safe integer range covers ~9 PB)
      storage_used_bytes: storageUsedBytes,
      // 0 means unlimited (server does not enforce a hard cap at this level)
      storage_total_bytes: 0,
      appUrl: process.env.APP_URL || 'http://192.168.86.170:8090',
    };
  }
}
