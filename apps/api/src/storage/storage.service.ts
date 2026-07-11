import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import * as fs from 'fs';
import { Readable } from 'stream';

const S3_ENDPOINT  = process.env.S3_ENDPOINT   || 'http://172.19.0.1:9000';
const S3_BUCKET    = process.env.S3_BUCKET      || 'photoapp';
const S3_REGION    = process.env.S3_REGION      || 'us-east-1';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'minioadmin';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || 'minioadmin';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      credentials: {
        accessKeyId: S3_ACCESS_KEY,
        secretAccessKey: S3_SECRET_KEY,
      },
      forcePathStyle: true, // required for MinIO
    });
  }

  async onModuleInit() {
    await this.ensureBucket();
  }

  private async ensureBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
      this.logger.log(`S3 bucket "${S3_BUCKET}" ready`);
    } catch (err: any) {
      const status = err.$metadata?.httpStatusCode;
      if (status === 404 || status === 403 || err.name === 'NoSuchBucket' || err.name === 'NotFound') {
        await this.client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
        this.logger.log(`Created S3 bucket "${S3_BUCKET}"`);
      } else {
        this.logger.error(`S3 bucket check failed: ${err.message}`);
        throw err;
      }
    }
  }

  get bucket() { return S3_BUCKET; }

  /**
   * A path is an S3 key when it does NOT start with '/'.
   * Local paths like /uploads/xyz.jpg start with '/'.
   * S3 keys like originals/xyz.jpg do not.
   */
  isS3Key(p: string): boolean {
    return !!p && !p.startsWith('/');
  }

  async putFile(localPath: string, key: string, contentType: string): Promise<void> {
    const body = fs.createReadStream(localPath);
    const size = fs.statSync(localPath).size;
    await this.client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: size,
    }));
    this.logger.debug(`Uploaded → s3://${S3_BUCKET}/${key}`);
  }

  async putBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.length,
    }));
  }

  async getStream(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }));
    return res.Body as Readable;
  }

  async getObjectSize(key: string): Promise<number> {
    const res = await this.client.send(new HeadObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }));
    return res.ContentLength ?? 0;
  }

  async getStreamRange(key: string, range: string): Promise<{ stream: Readable; contentLength: number; contentRange: string }> {
    const res = await this.client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Range: range,
    }));
    return {
      stream: res.Body as Readable,
      contentLength: res.ContentLength ?? 0,
      contentRange: res.ContentRange ?? '',
    };
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    } catch {}
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (!keys.length) return;
    const chunks: string[][] = [];
    for (let i = 0; i < keys.length; i += 1000) chunks.push(keys.slice(i, i + 1000));
    for (const chunk of chunks) {
      try {
        await this.client.send(new DeleteObjectsCommand({
          Bucket: S3_BUCKET,
          Delete: { Objects: chunk.map(Key => ({ Key })) },
        }));
      } catch {}
    }
  }

  /** Upload every file in a local directory recursively. Returns uploaded keys. */
  async uploadDir(localDir: string, s3Prefix: string): Promise<string[]> {
    const keys: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(fullPath);
        } else {
          const relative = fullPath.replace(localDir + '/', '');
          const key = `${s3Prefix}/${relative}`;
          const mime = mimeFromExt(entry.name);
          keys.push(key);
          this.putFile(fullPath, key, mime).catch(e =>
            this.logger.error(`Failed to upload ${fullPath}: ${e.message}`)
          );
        }
      }
    };
    walk(localDir);
    return keys;
  }

  /** Download an S3 object to a local file path. */
  async downloadToFile(key: string, localPath: string): Promise<void> {
    const stream = await this.getStream(key);
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(localPath);
      stream.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
      stream.on('error', reject);
    });
  }
}

function mimeFromExt(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'm3u8': return 'application/vnd.apple.mpegurl';
    case 'ts':   return 'video/mp2t';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'png':  return 'image/png';
    case 'mp4':  return 'video/mp4';
    default:     return 'application/octet-stream';
  }
}
