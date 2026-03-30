import {
  Controller, Get, Post, Patch, Delete, Param, Body, Request,
  UseGuards, Query, DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PeopleService } from './people.service';
import { User } from '@prisma/client';

@Controller('people')
@UseGuards(JwtAuthGuard)
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @Get()
  findAll(@Request() req: { user: User }) {
    return this.peopleService.findAll(req.user.id);
  }

  @Post('cluster')
  async cluster(@Request() req: { user: User }) {
    return this.peopleService.clusterFaces(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: { user: User }) {
    return this.peopleService.findOne(req.user.id, id);
  }

  @Get(':id/assets')
  findAssets(
    @Param('id') id: string,
    @Request() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.peopleService.findAssets(req.user.id, id, page, limit);
  }

  @Patch(':id')
  rename(
    @Param('id') id: string,
    @Body() body: { name: string },
    @Request() req: { user: User },
  ) {
    return this.peopleService.rename(req.user.id, id, body.name);
  }

  @Post(':id/merge/:targetId')
  merge(
    @Param('id') sourceId: string,
    @Param('targetId') targetId: string,
    @Request() req: { user: User },
  ) {
    return this.peopleService.mergePeople(req.user.id, sourceId, targetId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: { user: User }) {
    return this.peopleService.remove(req.user.id, id);
  }
}
