FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl vips-dev libheif-dev libde265-dev python3 make g++ ffmpeg

COPY package.json ./
ENV SHARP_FORCE_GLOBAL_LIBVIPS=1
RUN npm install && npm rebuild sharp --build-from-source

COPY tsconfig.json nest-cli.json ./
COPY prisma ./prisma/
COPY src ./src/

RUN npx prisma generate
RUN npm run build

# ---

FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl vips-dev libheif libde265 libheif-tools ffmpeg

ENV SHARP_FORCE_GLOBAL_LIBVIPS=1
COPY package.json ./
RUN npm install --omit=dev && npm rebuild sharp --build-from-source

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma/

RUN mkdir -p /uploads /thumbnails

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
