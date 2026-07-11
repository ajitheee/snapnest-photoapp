import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { HiddenController } from './hidden.controller';
import { EditService } from './edit.service';
import { LivePhotoEffectsService } from './live-photo-effects.service';
import { TrashPurgeService } from './trash-purge.service';
import { QueueService } from '../queue/queue.service';
import { ThumbnailProcessor } from '../queue/thumbnail.processor';
import { MetadataProcessor } from '../queue/metadata.processor';
import { TranscodeProcessor } from '../queue/transcode.processor';
import { MlJobsProcessor } from '../queue/ml-jobs.processor';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'thumbnail' },
      { name: 'metadata' },
      { name: 'transcode' },
      { name: 'ml' },
    ),
    MetricsModule,
  ],
  providers: [
    AssetsService,
    EditService,
    LivePhotoEffectsService,
    TrashPurgeService,
    QueueService,
    ThumbnailProcessor,
    MetadataProcessor,
    TranscodeProcessor,
    MlJobsProcessor,
  ],
  controllers: [AssetsController, HiddenController],
  exports: [AssetsService],
})
export class AssetsModule {}
