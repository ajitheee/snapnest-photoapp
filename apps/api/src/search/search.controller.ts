import { Controller, Get, Query, Request, UseGuards, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SearchService } from './search.service';
import { MemoryQueryService } from './memory-query.service';
import { User } from '@prisma/client';

@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly memoryQueryService: MemoryQueryService,
  ) {}

  @Get()
  search(
    @Query('q') query: string,
    @Query('mode') mode: 'text' | 'semantic' | 'auto' | 'memory' = 'auto',
    @Query('month') month: string,
    @Query('location') location: string,
    @Query('date_from') dateFrom: string,
    @Query('date_to') dateTo: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Request() req: { user: User },
  ) {
    if (mode === 'memory') {
      return this.memoryQueryService.query(req.user.id, query, limit);
    }
    return this.searchService.search(
      req.user.id, query, mode, page, limit, month, location, dateFrom, dateTo,
    );
  }
}
