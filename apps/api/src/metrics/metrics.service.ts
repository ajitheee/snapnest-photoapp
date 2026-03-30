import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { Counter, Gauge, register } from 'prom-client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  readonly uploadsTotal = new Counter({
    name: 'photoapp_uploads_total',
    help: 'Total number of assets uploaded',
    labelNames: ['asset_type'] as const,
  });

  readonly queueDepth = new Gauge({
    name: 'photoapp_queue_depth',
    help: 'Current number of waiting jobs per queue',
    labelNames: ['queue_name'] as const,
  });

  readonly storageBytesTotal = new Gauge({
    name: 'photoapp_storage_bytes_total',
    help: 'Total bytes stored across all non-deleted assets',
  });

  readonly activeUsers = new Gauge({
    name: 'photoapp_users_total',
    help: 'Total registered users',
  });

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('thumbnail') private readonly thumbnailQueue: Queue,
    @InjectQueue('metadata')  private readonly metadataQueue: Queue,
    @InjectQueue('transcode') private readonly transcodeQueue: Queue,
    @InjectQueue('ml')        private readonly mlQueue: Queue,
  ) {}

  incrementUpload(assetType: string) {
    this.uploadsTotal.inc({ asset_type: assetType.toLowerCase() });
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async updateQueueDepths() {
    const queues: [string, Queue][] = [
      ['thumbnail', this.thumbnailQueue],
      ['metadata',  this.metadataQueue],
      ['transcode', this.transcodeQueue],
      ['ml',        this.mlQueue],
    ];
    for (const [name, queue] of queues) {
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
        this.queueDepth.set({ queue_name: name }, (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0));
      } catch { /* queue may be empty */ }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async updateStorageMetrics() {
    try {
      const [storageResult, userCount] = await this.prisma.$transaction([
        this.prisma.asset.aggregate({ _sum: { fileSizeBytes: true }, where: { isDeleted: false } }),
        this.prisma.user.count(),
      ]);
      this.storageBytesTotal.set(Number(storageResult._sum.fileSizeBytes ?? 0));
      this.activeUsers.set(userCount);
    } catch (e) {
      this.logger.warn('Failed to update storage metrics: ' + e);
    }
  }

  getRegistry() {
    return register;
  }
}
