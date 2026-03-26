import { IsString, IsOptional, MaxLength } from 'class-validator';

export class UpdateAlbumDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  coverAssetId?: string;
}
