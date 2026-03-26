import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue('thumbnail') private thumbnailQueue: Queue,
    @InjectQueue('metadata') private metadataQueue: Queue,
    @InjectQueue('transcode') private transcodeQueue: Queue,
    @InjectQueue('ml') private mlQueue: Queue,
  ) {}

  async enqueueAfterUpload(assetId: string, assetType: string, filePath: string) {
    await Promise.all([
      this.thumbnailQueue.add('generate', { assetId, filePath, assetType }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      }),
      this.metadataQueue.add('extract', { assetId, filePath }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      }),
    ]);

    if (assetType === 'VIDEO') {
      await this.transcodeQueue.add('hls', { assetId, filePath }, {
        attempts: 2,
        backoff: { type: 'fixed', delay: 5000 },
      });
    }
  }

  async enqueueMlJobs(assetId: string, thumbnailPath: string, originalPath: string) {
    await Promise.all([
      this.mlQueue.add('clip-embed', { assetId, imagePath: thumbnailPath || originalPath }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
      }),
      this.mlQueue.add('face-detect', { assetId, imagePath: originalPath }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
      }),
      this.mlQueue.add('scene-tag', { assetId, imagePath: thumbnailPath || originalPath }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
      }),
    ]);
  }

  async enqueueGeocode(assetId: string, lat: number, lng: number) {
    await this.mlQueue.add('geocode', { assetId, lat, lng }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  }
}
