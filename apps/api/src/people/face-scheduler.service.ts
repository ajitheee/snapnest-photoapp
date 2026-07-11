import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PeopleService } from './people.service';

@Injectable()
export class FaceSchedulerService {
  private readonly logger = new Logger(FaceSchedulerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly peopleService: PeopleService,
    @InjectQueue('ml') private readonly mlQueue: Queue,
  ) {}

  /** Runs every 5 minutes. Does two things:
   *  1. Queues face-detect for any image assets whose thumbnails are ready
   *     but haven't been processed yet.
   *  2. Re-clusters faces for every user who has unassigned faces, but ONLY
   *     when no face-detect jobs are pending (avoids overloading ML service).
   */
  @Cron('*/30 * * * *')
  async runFaceIdentification() {
    if (this.running) {
      this.logger.warn('Face identification already running — skipping tick');
      return;
    }
    this.running = true;
    try {
      const queued = await this._queuePendingFaceDetect();
      // Only cluster when the face-detect queue is drained
      if (queued === 0) {
        await this._clusterUnassignedFaces();
      } else {
        this.logger.log(`Skipping clustering — ${queued} face-detect jobs still pending`);
      }
    } catch (err) {
      this.logger.error(`Face identification tick failed: ${err}`);
    } finally {
      this.running = false;
    }
  }

  /** Queue face-detect jobs for assets that have a thumbnail but no face scan yet.
   *  Returns the number of assets still pending (including those just queued). */
  private async _queuePendingFaceDetect(): Promise<number> {
    const totalPending = await this.prisma.assetJobStatus.count({
      where: {
        faceDetectedAt: null,
        asset: {
          isDeleted: false,
          type: { not: 'VIDEO' },
          thumbnailLargePath: { not: null },
        },
      },
    });

    if (totalPending === 0) return 0;

    const pending = await this.prisma.assetJobStatus.findMany({
      where: {
        faceDetectedAt: null,
        asset: {
          isDeleted: false,
          type: { not: 'VIDEO' },
          thumbnailLargePath: { not: null },
        },
      },
      include: {
        asset: { select: { thumbnailLargePath: true, originalPath: true } },
      },
      take: 10,
    });

    this.logger.log(`Queueing face-detect for ${pending.length} of ${totalPending} unprocessed asset(s)`);
    for (const job of pending) {
      await this.mlQueue.add(
        'face-detect',
        {
          assetId: job.assetId,
          imagePath: job.asset.thumbnailLargePath ?? job.asset.originalPath,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
      );
    }

    return totalPending;
  }

  /** Re-run clustering for every user who has faces not yet assigned to a person. */
  private async _clusterUnassignedFaces() {
    const rows = await this.prisma.face.findMany({
      where: { personId: null, confidence: { gte: 0.5 } },
      select: { ownerId: true },
      distinct: ['ownerId'],
    });

    if (rows.length === 0) return;

    this.logger.log(`Clustering faces for ${rows.length} user(s) with unassigned faces`);
    for (const { ownerId } of rows) {
      try {
        const result = await this.peopleService.clusterFaces(ownerId);
        this.logger.log(
          `Cluster done for user ${ownerId}: ${result.created} person(s) created`,
        );
      } catch (err) {
        this.logger.error(`Cluster failed for user ${ownerId}: ${err}`);
      }
    }
  }
}
