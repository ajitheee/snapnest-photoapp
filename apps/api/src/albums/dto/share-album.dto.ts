import { IsEmail } from 'class-validator';

export class ShareAlbumDto {
  @IsEmail()
  email: string;
}
