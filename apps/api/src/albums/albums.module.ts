import { Module } from '@nestjs/common';
import { AlbumsController } from './albums.controller';
import { AlbumsService } from './albums.service';
import { SmartAlbumsService } from './smart-albums.service';
import { AlbumCollaborationService } from './album-collaboration.service';
import { AlbumCollaborationController } from './album-collaboration.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AlbumsController, AlbumCollaborationController],
  providers: [AlbumsService, SmartAlbumsService, AlbumCollaborationService],
  exports: [AlbumsService],
})
export class AlbumsModule {}
