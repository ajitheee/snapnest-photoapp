import {
  Controller, Get, Post, Body, Request, UseGuards, UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Controller('hidden')
@UseGuards(JwtAuthGuard)
export class HiddenController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('set-pin')
  async setPin(@Request() req: { user: { id: string } }, @Body() body: { pin: string }) {
    if (!body.pin || body.pin.length < 4) {
      throw new UnauthorizedException('PIN must be at least 4 characters');
    }
    const hash = await bcrypt.hash(body.pin, 10);
    await this.prisma.user.update({ where: { id: req.user.id }, data: { hiddenPin: hash } });
    return { success: true };
  }

  @Post('verify-pin')
  async verifyPin(@Request() req: { user: { id: string } }, @Body() body: { pin: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: { hiddenPin: true },
    });
    if (!user?.hiddenPin) return { verified: true };
    const valid = await bcrypt.compare(body.pin, user.hiddenPin);
    if (!valid) throw new UnauthorizedException('Invalid PIN');
    return { verified: true };
  }

  @Post('remove-pin')
  async removePin(@Request() req: { user: { id: string } }, @Body() body: { pin: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: { hiddenPin: true },
    });
    if (user?.hiddenPin) {
      const valid = await bcrypt.compare(body.pin, user.hiddenPin);
      if (!valid) throw new UnauthorizedException('Invalid PIN');
    }
    await this.prisma.user.update({ where: { id: req.user.id }, data: { hiddenPin: null } });
    return { success: true };
  }

  @Get('status')
  async getStatus(@Request() req: { user: { id: string } }) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: { hiddenPin: true },
    });
    return { pinSet: !!user?.hiddenPin };
  }
}
