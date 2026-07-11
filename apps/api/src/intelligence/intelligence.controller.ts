import { Controller, Post, Param, Body, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IntelligenceService } from './intelligence.service';

@Controller('intelligence')
@UseGuards(JwtAuthGuard)
export class IntelligenceController {
  constructor(private readonly intelligenceService: IntelligenceService) {}

  @Post('lookup/:assetId')
  visualLookup(@Param('assetId') assetId: string, @Request() req: { user: { id: string } }) {
    return this.intelligenceService.visualLookup(assetId, req.user.id);
  }

  @Post('caption/:assetId')
  generateCaption(@Param('assetId') assetId: string, @Request() req: { user: { id: string } }) {
    return this.intelligenceService.generateCaption(assetId, req.user.id);
  }

  @Post('aesthetic/:assetId')
  aestheticScore(@Param('assetId') assetId: string, @Request() req: { user: { id: string } }) {
    return this.intelligenceService.aestheticScore(assetId, req.user.id);
  }

  @Post('video-search/:assetId')
  videoSearch(
    @Param('assetId') assetId: string,
    @Body() body: { query: string },
    @Request() req: { user: { id: string } },
  ) {
    return this.intelligenceService.videoSearch(assetId, req.user.id, body.query);
  }

  @Post('subject-lift/:assetId')
  subjectLift(
    @Param('assetId') assetId: string,
    @Body() body: { format?: string },
    @Request() req: { user: { id: string } },
  ) {
    return this.intelligenceService.subjectLift(assetId, req.user.id, body.format || 'png');
  }

  @Post('pets/:assetId')
  detectPets(@Param('assetId') assetId: string, @Request() req: { user: { id: string } }) {
    return this.intelligenceService.detectPets(assetId, req.user.id);
  }
}
