import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';
import { FaceSchedulerService } from './face-scheduler.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    BullModule.registerQueue({ name: 'ml' }),
  ],
  controllers: [PeopleController],
  providers: [PeopleService, FaceSchedulerService],
  exports: [PeopleService],
})
export class PeopleModule {}
