import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueService } from './queue.service';
import { ThumbnailProcessor } from './thumbnail.processor';
import { MetadataProcessor } from './metadata.processor';
import { TranscodeProcessor } from './transcode.processor';
import { MlJobsProcessor } from './ml-jobs.processor';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'thumbnail' },
      { name: 'metadata' },
      { name: 'transcode' },
      { name: 'ml' },
    ),
    PrismaModule,
  ],
  providers: [
    QueueService,
    ThumbnailProcessor,
    MetadataProcessor,
    TranscodeProcessor,
    MlJobsProcessor,
  ],
  exports: [QueueService],
})
export class QueueModule {}
