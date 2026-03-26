import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateShareLinkDto {
  @IsOptional()
  @IsString()
  albumId?: string;

  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
