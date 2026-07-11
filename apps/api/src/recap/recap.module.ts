import { Module } from '@nestjs/common';
import { RecapController } from './recap.controller';
import { RecapService } from './recap.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule],
  controllers: [RecapController],
  providers: [RecapService],
  exports: [RecapService],
})
export class RecapModule {}
