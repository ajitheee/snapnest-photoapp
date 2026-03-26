import { Module } from '@nestjs/common';
import { SharingService } from './sharing.service';
import { SharingController, PublicShareController } from './sharing.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SharingService],
  controllers: [SharingController, PublicShareController],
})
export class SharingModule {}
