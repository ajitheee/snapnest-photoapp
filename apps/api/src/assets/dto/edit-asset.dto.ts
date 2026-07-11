import {
  IsBoolean, IsNumber, IsOptional, IsString, ValidateNested, Max, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CropRegionDto {
  @IsNumber() @Min(0) @Max(1) left: number;
  @IsNumber() @Min(0) @Max(1) top: number;
  @IsNumber() @Min(0.01) @Max(1) width: number;
  @IsNumber() @Min(0.01) @Max(1) height: number;
}

export class EditAssetDto {
  // ── Actions ────────────────────────────────────────────────────────────────
  @IsOptional() @ValidateNested() @Type(() => CropRegionDto)
  crop?: CropRegionDto;

  @IsOptional() @IsNumber() @Min(0) @Max(1)
  unblur?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(1)
  portraitBlur?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(1)
  pop?: number;

  @IsOptional() @ValidateNested() @Type(() => CropRegionDto)
  magicEraser?: CropRegionDto;

  // ── Rotation (degrees: 0, 90, 180, 270) ───────────────────────────────────
  @IsOptional() @IsNumber() @Min(0) @Max(270)
  rotation?: number;

  // ── Straighten / Perspective / Flip (Phase 4) ──────────────────────────────
  @IsOptional() @IsNumber() @Min(-45) @Max(45)
  straighten?: number;

  @IsOptional() @IsNumber() @Min(-1) @Max(1)
  perspectiveV?: number;

  @IsOptional() @IsNumber() @Min(-1) @Max(1)
  perspectiveH?: number;

  @IsOptional() @IsBoolean()
  flipHorizontal?: boolean;

  @IsOptional() @IsBoolean()
  flipVertical?: boolean;

  @IsOptional() @IsString()
  aspectRatio?: string;

  // ── Filters ────────────────────────────────────────────────────────────────
  @IsOptional() @IsString()
  filter?: string;

  @IsOptional() @IsString()
  skyStyle?: string;

  // ── Lighting ───────────────────────────────────────────────────────────────
  @IsOptional() @IsBoolean()
  hdr?: boolean;

  @IsOptional() @IsBoolean()
  portraitLight?: boolean;

  @IsOptional() @IsNumber() @Min(-1) @Max(1)
  brightness?: number;

  @IsOptional() @IsNumber() @Min(-1) @Max(1)
  contrast?: number;

  @IsOptional() @IsNumber() @Min(-1) @Max(1)
  tone?: number;

  @IsOptional() @IsNumber() @Min(0.5) @Max(1)
  whitePoint?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(0.5)
  blackPoint?: number;

  @IsOptional() @IsNumber() @Min(-1) @Max(1)
  highlights?: number;

  @IsOptional() @IsNumber() @Min(-1) @Max(1)
  shadows?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(1)
  vignette?: number;

  // ── Colors ─────────────────────────────────────────────────────────────────
  @IsOptional() @IsNumber() @Min(-1) @Max(1)
  saturation?: number;

  @IsOptional() @IsNumber() @Min(-1) @Max(1)
  warmth?: number;

  @IsOptional() @IsNumber() @Min(-1) @Max(1)
  tint?: number;

  @IsOptional() @IsNumber() @Min(-1) @Max(1)
  skinTone?: number;

  @IsOptional() @IsNumber() @Min(-1) @Max(1)
  blueTone?: number;

  // ── Filter / Sky intensity ─────────────────────────────────────────────────
  @IsOptional() @IsNumber() @Min(0) @Max(1)
  filterIntensity?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(1)
  skyIntensity?: number;

  // ── Video edit ─────────────────────────────────────────────────────────────
  @IsOptional() @IsNumber() @Min(0)
  trimStartMs?: number;

  @IsOptional() @IsNumber() @Min(0)
  trimEndMs?: number;

  @IsOptional() @IsNumber() @Min(0.25) @Max(4)
  speed?: number;

  @IsOptional() @IsBoolean()
  muted?: boolean;

  @IsOptional() @IsBoolean()
  autoEnhance?: boolean;

  // ── Video crop/rotate (Phase 4) ────────────────────────────────────────────
  @IsOptional() @ValidateNested() @Type(() => CropRegionDto)
  videoCrop?: CropRegionDto;

  @IsOptional() @IsNumber() @Min(0) @Max(270)
  videoRotation?: number;
}
