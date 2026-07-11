import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { MemoryQueryService } from './memory-query.service';
import { SearchController } from './search.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SearchService, MemoryQueryService],
  controllers: [SearchController],
})
export class SearchModule {}
