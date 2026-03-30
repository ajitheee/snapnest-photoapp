import { IsNotEmpty, IsNumberString, IsOptional, IsString, Matches } from 'class-validator';

export class CreateUploadSessionDto {
  /** SHA-256 hex checksum of the complete file (computed client-side before upload). */
  @IsString()
  @Matches(/^[a-f0-9]{64}$/, { message: 'checksum must be a 64-character hex SHA-256' })
  checksum: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;

  /** Total file size in bytes, as a decimal string (avoid JS BigInt JSON issues). */
  @IsNumberString()
  fileSize: string;

  @IsString()
  @IsNotEmpty()
  mimeType: string;

  /** Optional client-side asset ID for dedup tracking. */
  @IsString()
  @IsOptional()
  deviceAssetId?: string;
}
