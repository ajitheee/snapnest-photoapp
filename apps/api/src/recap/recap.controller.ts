import { Controller, Get, Post, Param, Query, Res, UseGuards, Request } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RecapService } from './recap.service';
import { User } from '@prisma/client';

@Controller('recaps')
@UseGuards(JwtAuthGuard)
export class RecapController {
  constructor(private readonly recapService: RecapService) {}

  @Get()
  async listRecaps(@Request() req: { user: User }) {
    return this.recapService.getRecaps(req.user.id);
  }

  @Get(':id')
  async getRecap(@Request() req: { user: User }, @Param('id') id: string) {
    const recap = await this.recapService.getRecap(req.user.id, id);
    if (!recap) return { error: 'Not found' };
    return recap;
  }

  @Get(':id/video')
  async streamVideo(
    @Request() req: { user: User },
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const result = await this.recapService.streamRecapVideo(id, req.user.id);
    if (!result) {
      res.status(404).json({ error: 'Recap video not found' });
      return;
    }
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    result.stream.pipe(res);
  }

  @Get(':id/cover')
  async getCover(
    @Request() req: { user: User },
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const result = await this.recapService.getRecapCover(id, req.user.id);
    if (!result) {
      res.status(404).json({ error: 'Cover not found' });
      return;
    }
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    result.stream.pipe(res);
  }

  @Post('generate')
  async triggerGeneration(
    @Request() req: { user: User },
    @Query('weeks') weeksBack: string,
  ) {
    const weeks = Math.min(parseInt(weeksBack, 10) || 4, 12);
    const results: any[] = [];
    for (let w = 0; w < weeks; w++) {
      const d = new Date();
      d.setDate(d.getDate() - w * 7);
      try {
        const recap = await this.recapService.generateWeeklyRecap(req.user.id, d);
        if (recap) results.push(recap);
      } catch {}
    }
    if (results.length === 0) return { message: 'No photos found in the last few weeks to generate recaps' };
    return results;
  }
}
