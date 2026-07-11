import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { AssetsModule } from './assets/assets.module';
import { UsersModule } from './users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { AlbumsModule } from './albums/albums.module';
import { SharingModule } from './sharing/sharing.module';
import { SearchModule } from './search/search.module';
import { PeopleModule } from './people/people.module';
// Phase 5 — Mobile & Sync
import { DevicesModule } from './devices/devices.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MemoriesModule } from './memories/memories.module';
// Phase 6 — Production Hardening
import { AdminModule } from './admin/admin.module';
import { MetricsModule } from './metrics/metrics.module';
// Phase 7 — Weekly Recaps
import { RecapModule } from './recap/recap.module';
// Phase 8 — Intelligence Foundation
import { DuplicatesModule } from './duplicates/duplicates.module';
// Phase 9 — Organization & Privacy
import { TripsModule } from './trips/trips.module';
// Phase 10 — Delight Layer
import { IntelligenceModule } from './intelligence/intelligence.module';
// Server info endpoint
import { ServerModule } from './server/server.module';

@Module({
  imports: [
    StorageModule,
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    UsersModule,
    AuthModule,
    AssetsModule,
    QueueModule,
    AlbumsModule,
    SharingModule,
    SearchModule,
    PeopleModule,
    // Phase 5
    DevicesModule,
    NotificationsModule,
    MemoriesModule,
    // Phase 6
    AdminModule,
    MetricsModule,
    // Phase 7
    RecapModule,
    // Phase 8
    DuplicatesModule,
    // Phase 9
    TripsModule,
    // Phase 10
    IntelligenceModule,
    ServerModule,
  ],
})
export class AppModule {}
