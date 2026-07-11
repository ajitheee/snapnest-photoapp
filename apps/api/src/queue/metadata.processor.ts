import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as exifr from 'exifr';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from './queue.service';
import { StorageService } from '../storage/storage.service';

const UPLOAD_DIR = process.env.UPLOAD_PATH || '/uploads';
const execFileAsync = promisify(execFile);

function stripNullBytes(obj: unknown): unknown {
  if (typeof obj === 'string') return obj.replace(/\0/g, '');
  if (Array.isArray(obj)) return obj.map(stripNullBytes);
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = stripNullBytes(v);
    return out;
  }
  return obj;
}

// Uppercase UUID pattern — Apple Live Photo ContentIdentifier format
const UUID_RE = /([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})/;

/**
 * Extract Apple Live Photo ContentIdentifier from an HEIC/HEIF/JPEG file.
 * - HEIC: single uppercase UUID in the ISOBMFF container = ContentIdentifier
 * - JPEG: ContentIdentifier is the FIRST uppercase UUID found within the first
 *   8 KB of the file (stored in Apple MakerNote early in the EXIF data).
 *   Limiting to 8 KB avoids false-positives from face-detection UUIDs that
 *   appear much later in the file.
 */
function extractHeicContentId(filePath: string): string | null {
  try {
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    // For JPEG: only search first 8 KB — ContentIdentifier lives in Apple MakerNote early in EXIF
    const limit = ['.jpg', '.jpeg'].includes(ext) ? Math.min(buf.length, 8192) : buf.length;
    const raw = buf.slice(0, limit).toString('binary');
    const match = UUID_RE.exec(raw);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Extract Apple Live Photo ContentIdentifier from a MOV/MP4 file.
 * iPhone stores it as QuickTime metadata tag
 * 'com.apple.quicktime.content.identifier'.
 * Returns null if no QuickTime content.identifier tag found.
 */
async function extractMovContentId(filePath: string): Promise<string | null> {
  // Primary: ffprobe QuickTime tags
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath],
      { timeout: 15000 },
    );
    const probe = JSON.parse(stdout);
    const tag =
      probe?.format?.tags?.['com.apple.quicktime.content.identifier'] ??
      probe?.format?.tags?.['com.apple.photos.content.identifier'];
    if (tag && UUID_RE.test(tag.toUpperCase())) {
      return tag.toUpperCase();
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Try to link an IMAGE asset with its companion VIDEO (or vice-versa) using
 * the shared Apple ContentIdentifier.
 */
async function tryLivePairing(
  assetId: string,
  contentId: string,
  prisma: PrismaService,
  logger: Logger,
): Promise<void> {
  const thisAsset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { type: true, ownerId: true, originalPath: true, isLivePhoto: true },
  });
  if (!thisAsset) return;

  // Only pair IMAGE↔VIDEO
  const partnerType = thisAsset.type === 'IMAGE' ? 'VIDEO' : 'IMAGE';
  const partner = await (prisma.asset as any).findFirst({
    where: {
      ownerId: thisAsset.ownerId,
      appleContentId: contentId,
      id: { not: assetId },
      type: partnerType,
      isDeleted: false,
    },
    select: { id: true, originalPath: true, type: true },
  });

  if (!partner) return;

  // Always: IMAGE gets isLivePhoto=true + livePhotoVideoPath
  const imageId   = thisAsset.type === 'IMAGE' ? assetId        : partner.id;
  const videoPath = thisAsset.type === 'VIDEO' ? thisAsset.originalPath : partner.originalPath;

  await prisma.asset.update({
    where: { id: imageId },
    data: { isLivePhoto: true, livePhotoVideoPath: videoPath },
  });
  logger.log(`Live Photo auto-paired: image=${imageId} video=${videoPath} (contentId=${contentId})`);
}

@Processor('metadata')
export class MetadataProcessor extends WorkerHost {
  private readonly logger = new Logger(MetadataProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<{ assetId: string; filePath: string }>) {
    const { assetId } = job.data;
    let { filePath } = job.data;

    // If the job carries an S3 key, download to a local temp file first
    let tempDownload = false;
    if (this.storage.isS3Key(filePath)) {
      const ext = path.extname(filePath) || '.bin';
      const tmpPath = path.join(UPLOAD_DIR, `meta_tmp_${assetId}${ext}`);
      try {
        await this.storage.downloadToFile(filePath, tmpPath);
        filePath = tmpPath;
        tempDownload = true;
      } catch (err) {
        this.logger.warn(`Could not download S3 file for metadata: ${assetId}: ${err}`);
        return;
      }
    }
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

    // Check if GPS was already set by the mobile client
    const existing = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { locationLat: true, locationLng: true },
    });
    const alreadyHasGps = existing?.locationLat != null && existing?.locationLng != null;

    const updateData: Record<string, any> = { exifData: stripNullBytes(exifData) };
    if (width)  updateData.width  = width;
    if (height) updateData.height = height;
    if (fileCreatedAt) updateData.fileCreatedAt = fileCreatedAt;
    if (!alreadyHasGps && lat != null && !isNaN(lat)) {
      updateData.locationLat = lat;
      updateData.locationLng = lng;
    }

    await this.prisma.asset.update({ where: { id: assetId }, data: updateData });

    await this.prisma.assetJobStatus.update({
      where: { assetId },
      data: { metadataDoneAt: new Date() },
    });

    // ── Apple Live Photo ContentIdentifier pairing (MOV only via ffprobe) ────
    // HEIC binary scan removed — it found false-positive UUIDs in all HEIC files.
    // Only MOV files carry a reliable ContentIdentifier via QuickTime metadata.
    const ext = path.extname(filePath).toLowerCase();
    if (['.mov', '.mp4', '.m4v'].includes(ext)) {
      const contentId = await extractMovContentId(filePath);
      if (contentId) {
        this.logger.log(`MOV ContentIdentifier: ${contentId} (${assetId})`);
        try {
          await this.prisma.asset.update({
            where: { id: assetId },
            data: { appleContentId: contentId },
          });
          await tryLivePairing(assetId, contentId, this.prisma, this.logger);
        } catch (err) {
          this.logger.warn(`Live Photo pairing failed for ${assetId}: ${err}`);
        }
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    // Trigger geocoding
    const gpsLat = alreadyHasGps ? existing!.locationLat! : lat;
    const gpsLng = alreadyHasGps ? existing!.locationLng! : lng;
    if (gpsLat != null && gpsLng != null && !isNaN(gpsLat) && !isNaN(gpsLng)) {
      await this.queueService.enqueueGeocode(assetId, gpsLat, gpsLng);
    }

    if (tempDownload) { try { fs.unlinkSync(filePath); } catch {} }

    this.logger.log(`Metadata done for ${assetId}${lat != null ? ` (GPS: ${lat},${lng})` : ''}`);
  }
}
