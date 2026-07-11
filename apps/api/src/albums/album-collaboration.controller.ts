import { Controller, Get, Post, Delete, Param, Body, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AlbumCollaborationService } from './album-collaboration.service';
import { User } from '@prisma/client';

@Controller('albums')
@UseGuards(JwtAuthGuard)
export class AlbumCollaborationController {
  constructor(private readonly collaborationService: AlbumCollaborationService) {}

  @Post(':id/comments')
  addComment(
    @Param('id') albumId: string,
    @Body() body: { text: string; assetId?: string },
    @Request() req: { user: User },
  ) {
    return this.collaborationService.addComment(albumId, req.user.id, req.user.name, body.text, body.assetId);
  }

  @Get(':id/comments')
  getComments(@Param('id') albumId: string, @Request() req: { user: User }) {
    return this.collaborationService.getComments(albumId, req.user.id);
  }

  @Delete('comments/:commentId')
  deleteComment(@Param('commentId') commentId: string, @Request() req: { user: User }) {
    return this.collaborationService.deleteComment(commentId, req.user.id);
  }

  @Post(':id/likes')
  toggleLike(
    @Param('id') albumId: string,
    @Body() body: { assetId: string },
    @Request() req: { user: User },
  ) {
    return this.collaborationService.toggleLike(albumId, body.assetId, req.user.id, req.user.name);
  }

  @Get(':id/likes')
  getLikes(@Param('id') albumId: string, @Request() req: { user: User }) {
    return this.collaborationService.getLikes(albumId, req.user.id);
  }

  @Get(':id/activity')
  getActivity(@Param('id') albumId: string, @Request() req: { user: User }, @Query('limit') limit?: string) {
    return this.collaborationService.getActivity(albumId, req.user.id, limit ? parseInt(limit) : 50);
  }

  @Post(':id/contribute')
  contributeAsset(
    @Param('id') albumId: string,
    @Body() body: { assetId: string },
    @Request() req: { user: User },
  ) {
    return this.collaborationService.contributeAsset(albumId, body.assetId, req.user.id, req.user.name);
  }
}
