import { IsDateString, IsOptional, IsString } from 'class-validator';

export class UploadAssetDto {
  @IsOptional()
  @IsDateString()
  fileCreatedAt?: string;

  @IsOptional()
  @IsString()
  deviceAssetId?: string;
}
