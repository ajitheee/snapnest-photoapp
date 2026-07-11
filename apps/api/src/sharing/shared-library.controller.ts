import { Controller, Get, Post, Delete, Param, Body, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SharedLibraryService } from './shared-library.service';
import { User } from '@prisma/client';

@Controller('shared-library')
@UseGuards(JwtAuthGuard)
export class SharedLibraryController {
  constructor(private readonly sharedLibraryService: SharedLibraryService) {}

  @Post()
  create(@Request() req: { user: User }, @Body() body: { name: string; memberEmails: string[]; rules?: any }) {
    return this.sharedLibraryService.create(req.user.id, body.name, body.memberEmails, body.rules);
  }

  @Get()
  list(@Request() req: { user: User }) {
    return this.sharedLibraryService.getMyLibraries(req.user.id);
  }

  @Get(':id/assets')
  getAssets(
    @Param('id') id: string,
    @Request() req: { user: User },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.sharedLibraryService.getLibraryAssets(id, req.user.id, page ? +page : 1, limit ? +limit : 50);
  }

  @Post(':id/members')
  addMember(@Param('id') id: string, @Request() req: { user: User }, @Body() body: { email: string }) {
    return this.sharedLibraryService.addMember(id, req.user.id, body.email);
  }

  @Delete(':id/members/:memberId')
  removeMember(@Param('id') id: string, @Param('memberId') memberId: string, @Request() req: { user: User }) {
    return this.sharedLibraryService.removeMember(id, req.user.id, memberId);
  }

  @Delete(':id')
  deleteLibrary(@Param('id') id: string, @Request() req: { user: User }) {
    return this.sharedLibraryService.deleteLibrary(id, req.user.id);
  }
}
