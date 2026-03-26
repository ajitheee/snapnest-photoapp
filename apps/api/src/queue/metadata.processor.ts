import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as exifr from 'exifr';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from './queue.service';

@Processor('metadata')
export class MetadataProcessor extends WorkerHost {
  private readonly logger = new Logger(MetadataProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {
    super();
  }

  async process(job: Job<{ assetId: string; filePath: string }>) {
    const { assetId, filePath } = job.data;
    this.logger.log(`Extracting metadata for asset ${assetId}`);

    let exifData: Record<string, any> = {};
    let width: number | undefined;
    let height: number | undefined;
    let fileCreatedAt: Date | undefined;
    let lat: number | undefined;
    let lng: number | undefined;

    try {
      const raw = await (exifr as any).parse(filePath, {
        tiff: true,
        exif: true,
        gps: true,
        iptc: true,
        icc: false,
        xmp: false,
        translateKeys: true,
        translateValues: true,
      });

      if (raw) {
        exifData = raw;
        width = raw.ImageWidth || raw.ExifImageWidth;
        height = raw.ImageHeight || raw.ExifImageHeight;

        const dateTaken = raw.DateTimeOriginal || raw.CreateDate || raw.DateTime;
        if (dateTaken instanceof Date && !isNaN(dateTaken.getTime())) {
          fileCreatedAt = dateTaken;
        }

        if (raw.latitude != null && raw.longitude != null) {
          lat = raw.latitude;
          lng = raw.longitude;
        }
      }
    } catch (err) {
      this.logger.warn(`EXIF parse failed for ${assetId}: ${err}`);
    }

    const updateData: Record<string, any> = {
      exifData,
    };
    if (width) updateData.width = width;
    if (height) updateData.height = height;
    if (fileCreatedAt) updateData.fileCreatedAt = fileCreatedAt;
    if (lat != null) {
      updateData.locationLat = lat;
      updateData.locationLng = lng;
    }

    await this.prisma.asset.update({
      where: { id: assetId },
      data: updateData,
    });

    await this.prisma.assetJobStatus.update({
      where: { assetId },
      data: { metadataDoneAt: new Date() },
    });

    if (lat != null && lng != null) {
      await this.queueService.enqueueGeocode(assetId, lat, lng);
    }

    this.logger.log(`Metadata done for ${assetId}${lat != null ? ` (GPS: ${lat},${lng})` : ''}`);
  }
}
