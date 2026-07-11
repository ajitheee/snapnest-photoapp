import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TripsService } from './trips.service';

@Controller('trips')
@UseGuards(JwtAuthGuard)
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Get()
  getTrips(@Request() req: { user: { id: string } }) {
    return this.tripsService.getTrips(req.user.id);
  }

  @Get('assets')
  getTripAssets(
    @Request() req: { user: { id: string } },
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('location') location: string,
  ) {
    return this.tripsService.getTripAssets(req.user.id, startDate, endDate, location);
  }
}
