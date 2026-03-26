import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AssetsService } from './assets.service';

@Injectable()
export class TrashPurgeService {
  private readonly logger = new Logger(TrashPurgeService.name);

  constructor(private readonly assetsService: AssetsService) {}

  @Cron('0 3 * * *')
  async purge() {
    this.logger.log('Running scheduled trash purge...');
    const count = await this.assetsService.purgeExpiredTrash();
    this.logger.log(`Trash purge complete: ${count} asset(s) permanently deleted`);
  }
}
