import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import axios from 'axios';
import * as crypto from 'crypto';

const ML_URL = process.env.ML_SERVICE_URL || 'http://ml:3003';

@Injectable()
export class IntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async visualLookup(assetId: string, ownerId: string) {
    const asset = await this.getAsset(assetId, ownerId);
    const imagePath = asset.thumbnailLargePath || asset.originalPath;
    const res = await axios.post(`${ML_URL}/lookup`, { image_path: imagePath }, { timeout: 30000 });
    return res.data;
  }

  async generateCaption(assetId: string, ownerId: string) {
    const asset = await this.getAsset(assetId, ownerId);
    const imagePath = asset.thumbnailLargePath || asset.originalPath;
    const res = await axios.post(`${ML_URL}/caption`, { image_path: imagePath }, { timeout: 30000 });
    if (res.data.caption && !(asset as any).caption) {
      await this.prisma.asset.update({
        where: { id: assetId },
        data: { caption: res.data.caption },
      });
    }
    return res.data;
  }

  async aestheticScore(assetId: string, ownerId: string) {
    const asset = await this.getAsset(assetId, ownerId);
    const imagePath = asset.thumbnailLargePath || asset.originalPath;
    const res = await axios.post(`${ML_URL}/score/aesthetic`, { image_path: imagePath }, { timeout: 30000 });
    return res.data;
  }

  async videoSearch(assetId: string, ownerId: string, query: string) {
    const asset = await this.getAsset(assetId, ownerId);
    if (asset.type !== 'VIDEO') throw new NotFoundException('Not a video');
    const videoPath = asset.originalPath;
    const res = await axios.post(`${ML_URL}/search/video`, { video_path: videoPath, query }, { timeout: 120000 });
    return res.data;
  }

  async subjectLift(assetId: string, ownerId: string, format: string) {
    const asset = await this.getAsset(assetId, ownerId);
    const imagePath = asset.thumbnailLargePath || asset.originalPath;
    const res = await axios.post(
      `${ML_URL}/edit/subject-lift`,
      { image_path: imagePath, format },
      { responseType: 'arraybuffer', timeout: 60000 },
    );
    const ext = format === 'png' ? '.png' : '.jpg';
    const key = `subject-lift/${assetId}/${crypto.randomUUID()}${ext}`;
    const buffer = Buffer.from(res.data);
    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    await this.storage.putBuffer(key, buffer, mimeType);
    return { path: key, mimeType, size: buffer.length };
  }

  async detectPets(assetId: string, ownerId: string) {
    const asset = await this.getAsset(assetId, ownerId);
    const imagePath = asset.thumbnailLargePath || asset.originalPath;
    const res = await axios.post(`${ML_URL}/detect/pets`, { image_path: imagePath }, { timeout: 30000 });
    return res.data;
  }

  private async getAsset(assetId: string, ownerId: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset || asset.isDeleted) throw new NotFoundException();
    if (asset.ownerId !== ownerId) throw new ForbiddenException();
    return asset;
  }
}
