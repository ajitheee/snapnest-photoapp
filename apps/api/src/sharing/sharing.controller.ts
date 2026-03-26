import {
  Controller, Get, Post, Delete,
  Param, Body, Query, Request, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SharingService } from './sharing.service';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { User } from '@prisma/client';

@Controller('sharing')
@UseGuards(JwtAuthGuard)
export class SharingController {
  constructor(private readonly sharingService: SharingService) {}

  @Post()
  create(@Body() dto: CreateShareLinkDto, @Request() req: { user: User }) {
    return this.sharingService.create(req.user.id, dto);
  }

  @Get()
  findAll(@Request() req: { user: User }) {
    return this.sharingService.findAll(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: { user: User }) {
    return this.sharingService.findOne(id, req.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Request() req: { user: User }) {
    return this.sharingService.remove(id, req.user.id);
  }
}

@Controller('s')
export class PublicShareController {
  constructor(private readonly sharingService: SharingService) {}

  @Get(':token')
  resolve(
    @Param('token') token: string,
    @Query('password') password?: string,
  ) {
    return this.sharingService.resolvePublicLink(token, password);
  }
}
