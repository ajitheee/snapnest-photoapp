import { Controller, Get, Post, Body, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DuplicatesService } from './duplicates.service';
import { User } from '@prisma/client';

@Controller('duplicates')
@UseGuards(JwtAuthGuard)
export class DuplicatesController {
  constructor(private readonly duplicatesService: DuplicatesService) {}

  @Get()
  findDuplicates(@Request() req: { user: User }) {
    return this.duplicatesService.findDuplicates(req.user.id);
  }

  @Post('merge')
  mergeDuplicates(
    @Request() req: { user: User },
    @Body() body: { keepId: string; removeIds: string[] },
  ) {
    return this.duplicatesService.mergeDuplicates(req.user.id, body.keepId, body.removeIds);
  }
}
