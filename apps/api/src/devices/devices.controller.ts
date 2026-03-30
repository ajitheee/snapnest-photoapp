import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { User } from '@prisma/client';

@Controller('devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  /**
   * POST /devices/register
   * Register (or refresh) a FCM / APNs push token for the authenticated user's device.
   * Safe to call on every app launch — uses upsert under the hood.
   */
  @Post('register')
  async register(
    @Body() dto: RegisterDeviceDto,
    @Request() req: { user: User },
  ) {
    return this.devicesService.register(
      req.user.id,
      dto.token,
      dto.platform,
      dto.appVersion,
    );
  }

  /**
   * DELETE /devices/:token
   * Unregister a push token (called on logout or when the user disables notifications).
   */
  @Delete(':token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregister(
    @Param('token') token: string,
    @Request() req: { user: User },
  ) {
    await this.devicesService.unregister(req.user.id, token);
  }
}
