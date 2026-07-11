import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';

const ML_URL = process.env.ML_SERVICE_URL || 'http://ml:3003';

@Processor('ml', { concurrency: 1 })
export class MlJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(MlJobsProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job) {
    switch (job.name) {
      case 'clip-embed':   return this.clipEmbed(job.data);
      case 'face-detect':  return this.faceDetect(job.data);
      case 'scene-tag':    return this.sceneTag(job.data);
      case 'geocode':      return this.geocode(job.data);
      case 'ocr':          return this.ocr(job.data);
      case 'phash':        return this.phash(job.data);
      default:
        this.logger.warn(`Unknown ML job: ${job.name}`);
    }
  }

  private async clipEmbed(data: { assetId: string; imagePath: string }) {
    const { assetId, imagePath } = data;
    this.logger.log(`CLIP embed for ${assetId}`);

    const res = await axios.post(`${ML_URL}/embed/image`, { image_path: imagePath }, { timeout: 60000 });
    const embedding: number[] = res.data.embedding;

    if (embedding?.length === 512) {
      const vec = `[${embedding.join(',')}]`;
      await this.prisma.$executeRaw`
        UPDATE assets SET "clipEmbedding" = ${vec}::vector WHERE id = ${assetId}
      `;
    }

    await this.prisma.assetJobStatus.update({
      where: { assetId },
      data: { clipEmbeddedAt: new Date() },
    });

    this.logger.log(`CLIP embed done for ${assetId} (dim=${embedding?.length})`);
  }

  private async faceDetect(data: { assetId: string; imagePath: string }) {
    const { assetId, imagePath } = data;
    this.logger.log(`Face detect for ${assetId}`);

    const res = await axios.post(`${ML_URL}/detect/faces`, { image_path: imagePath }, { timeout: 60000 });
    const faces: any[] = res.data.faces || [];

    // Get asset ownerId
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId }, select: { ownerId: true } });
    if (!asset) return;

    // Save each face to the faces table
    if (faces.length > 0) {
      for (let i = 0; i < faces.length; i++) {
        const face = faces[i];
        await this.prisma.face.upsert({
          where: { assetId_faceIndex: { assetId, faceIndex: i } },
          create: {
            assetId,
            ownerId: asset.ownerId,
            faceIndex: i,
            bbox: face.bounding_box,
            embedding: face.embedding,
            confidence: face.confidence,
          },
          update: {
            bbox: face.bounding_box,
            embedding: face.embedding,
            confidence: face.confidence,
          },
        });
      }
    }

    await this.prisma.assetJobStatus.update({
      where: { assetId },
      data: {
        faceDetectedAt: new Date(),
        faceData: faces.length > 0 ? faces : undefined,
      },
    });

    this.logger.log(`Face detect done for ${assetId}: ${faces.length} face(s)`);
  }

  private async sceneTag(data: { assetId: string; imagePath: string }) {
    const { assetId, imagePath } = data;
    this.logger.log(`Scene tag for ${assetId}`);

    const res = await axios.post(`${ML_URL}/tag/scene`, { image_path: imagePath }, { timeout: 60000 });
    const tags: { tag: string; confidence: number }[] = res.data.tags || [];

    if (tags.length > 0) {
      await this.prisma.$transaction(
        tags.map((t) =>
          this.prisma.assetTag.upsert({
            where: { assetId_tag: { assetId, tag: t.tag } },
            create: { assetId, tag: t.tag, confidence: t.confidence },
            update: { confidence: t.confidence },
          }),
        ),
      );
    }

    await this.prisma.assetJobStatus.update({
      where: { assetId },
      data: { sceneTaggedAt: new Date() },
    });

    this.logger.log(`Scene tag done for ${assetId}: [${tags.map((t) => t.tag).join(', ')}]`);
  }

  private async geocode(data: { assetId: string; lat: number; lng: number }) {
    const { assetId, lat, lng } = data;
    this.logger.log(`Geocode for ${assetId}: ${lat},${lng}`);

    const res = await axios.post(`${ML_URL}/geocode`, { lat, lng }, { timeout: 30000 });
    const { city, state, country } = res.data;

    await this.prisma.asset.update({
      where: { id: assetId },
      data: { locationCity: city, locationState: state, locationCountry: country },
    });

    await this.prisma.assetJobStatus.update({
      where: { assetId },
      data: { geocodeDoneAt: new Date() },
    });

    this.logger.log(`Geocode done for ${assetId}: ${city}, ${state}, ${country}`);
  }

  private async ocr(data: { assetId: string; imagePath: string }) {
    const { assetId, imagePath } = data;
    this.logger.log(`OCR for ${assetId}`);

    try {
      const res = await axios.post(`${ML_URL}/ocr`, { image_path: imagePath }, { timeout: 60000 });
      const { text, confidence } = res.data;

      if (text && text.trim().length > 0) {
        await this.prisma.asset.update({
          where: { id: assetId },
          data: { ocrText: text.trim() },
        });
      }

      await this.prisma.assetJobStatus.update({
        where: { assetId },
        data: { ocrDoneAt: new Date() },
      });

      this.logger.log(`OCR done for ${assetId}: ${text?.length || 0} chars (conf=${confidence})`);
    } catch (err: any) {
      this.logger.warn(`OCR failed for ${assetId}: ${err.message}`);
      await this.prisma.assetJobStatus.update({
        where: { assetId },
        data: { ocrDoneAt: new Date() },
      });
    }
  }

  private async phash(data: { assetId: string; imagePath: string }) {
    const { assetId, imagePath } = data;
    this.logger.log(`pHash for ${assetId}`);

    try {
      const res = await axios.post(`${ML_URL}/phash`, { image_path: imagePath }, { timeout: 30000 });
      const { hash } = res.data;

      if (hash) {
        await this.prisma.asset.update({
          where: { id: assetId },
          data: { perceptualHash: hash },
        });
      }

      await this.prisma.assetJobStatus.update({
        where: { assetId },
        data: { pHashDoneAt: new Date() },
      });

      this.logger.log(`pHash done for ${assetId}: ${hash}`);
    } catch (err: any) {
      this.logger.warn(`pHash failed for ${assetId}: ${err.message}`);
      await this.prisma.assetJobStatus.update({
        where: { assetId },
        data: { pHashDoneAt: new Date() },
      });
    }
  }
}
