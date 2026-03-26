import { IsArray, IsString, ArrayNotEmpty } from 'class-validator';

export class AddAssetsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  assetIds: string[];
}
