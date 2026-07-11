import { IsBoolean, IsDateString, IsNumberString, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class UploadAssetDto {
  @IsOptional()
  @IsDateString()
  fileCreatedAt?: string;

  @IsOptional()
  @IsString()
  deviceAssetId?: string;

  @IsOptional()
  @IsNumberString()
  locationLat?: string;

  @IsOptional()
  @IsNumberString()
  locationLng?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isLivePhoto?: boolean;
}
