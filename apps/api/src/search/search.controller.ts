import { Controller, Get, Query, Request, UseGuards, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SearchService } from './search.service';
import { User } from '@prisma/client';

@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(
    @Query('q') query: string,
    @Query('mode') mode: 'text' | 'semantic' | 'auto' = 'auto',
    @Query('month') month: string,
    @Query('location') location: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Request() req: { user: User },
  ) {
    return this.searchService.search(req.user.id, query, mode, page, limit, month, location);
  }
}
