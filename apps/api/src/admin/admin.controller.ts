import {
  Controller, Get, Patch, Delete, Post, Param, Body, Query,
  UseGuards, DefaultValuePipe, ParseIntPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  getUsers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.adminService.getUsers(page, limit);
  }

  @Patch('users/:id')
  updateUser(
    @Param('id') id: string,
    @Body() patch: { name?: string; isAdmin?: boolean; storageLimitBytes?: string | null },
  ) {
    return this.adminService.updateUser(id, patch);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @Post('requeue-face-detection')
  requeueFaceDetection() {
    return this.adminService.requeueMissingFaceDetection();
  }
}
