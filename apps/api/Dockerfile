FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl vips-dev python3 make g++ ffmpeg

COPY package.json ./
RUN npm install

COPY tsconfig.json nest-cli.json ./
COPY prisma ./prisma/
COPY src ./src/

RUN npx prisma generate
RUN npm run build

# ---

FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl vips ffmpeg

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/sharp ./node_modules/sharp
COPY prisma ./prisma/

RUN mkdir -p /uploads /thumbnails

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
