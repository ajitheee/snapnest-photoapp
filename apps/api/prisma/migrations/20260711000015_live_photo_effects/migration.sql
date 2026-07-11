-- Live Photo effects (Loop / Bounce / Long Exposure) and Key Photo selection
ALTER TABLE "assets" ADD COLUMN "liveEffect" TEXT;
ALTER TABLE "assets" ADD COLUMN "liveEffectPath" TEXT;
ALTER TABLE "assets" ADD COLUMN "keyPhotoTimestampMs" INTEGER;
