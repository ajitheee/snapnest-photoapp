import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { User } from '@prisma/client';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Request() req: { user: User }) {
    const { passwordHash: _, storageUsedBytes, storageLimitBytes, ...rest } = req.user as any;
    return {
      ...rest,
      // Serialize BigInt fields as strings so JSON.stringify doesn't throw
      storageUsedBytes: storageUsedBytes?.toString() ?? '0',
      storageLimitBytes: storageLimitBytes?.toString() ?? null,
    };
  }

}
