import { Module } from '@nestjs/common';
import { SharingService } from './sharing.service';
import { SharingController, PublicShareController } from './sharing.controller';
import { SharedLibraryService } from './shared-library.service';
import { SharedLibraryController } from './shared-library.controller';
import { SharingSuggestionsService } from './sharing-suggestions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  providers: [SharingService, SharedLibraryService, SharingSuggestionsService],
  controllers: [SharingController, PublicShareController, SharedLibraryController],
  exports: [SharingSuggestionsService],
})
export class SharingModule {}
