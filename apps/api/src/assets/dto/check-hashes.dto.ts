import { IsArray, IsString, ArrayMaxSize } from 'class-validator';

export class CheckHashesDto {
  /** Up to 500 SHA-256 checksums to check in one request. */
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  checksums: string[];
}
