import { Controller, Get, Patch, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService, UserPreferences } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('preferences')
  async getPreferences(@Request() req: { user: { id: string } }) {
    return this.usersService.getPreferences(req.user.id);
  }

  @Patch('preferences')
  async updatePreferences(
    @Request() req: { user: { id: string } },
    @Body() patch: Partial<UserPreferences>,
  ) {
    return this.usersService.updatePreferences(req.user.id, patch);
  }
}
