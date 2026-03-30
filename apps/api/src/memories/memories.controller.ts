import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MemoriesService } from './memories.service';
import { User } from '@prisma/client';

@Controller('memories')
@UseGuards(JwtAuthGuard)
export class MemoriesController {
  constructor(private readonly memoriesService: MemoriesService) {}

  /**
   * GET /memories
   *
   * Returns on-this-day photos, a random photo for the iOS home screen widget,
   * and recent favourites. Designed to be called once per app launch and cached
   * on-device; the widget refreshes via BGAppRefreshTask every few hours.
   */
  @Get()
  async getMemories(@Request() req: { user: User }) {
    return this.memoriesService.getMemories(req.user.id);
  }
}
