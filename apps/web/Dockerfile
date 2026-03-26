FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY svelte.config.js vite.config.ts tsconfig.json ./
COPY src ./src/
COPY static ./static/

RUN npm run build

# ---

FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./

# Install only production deps needed for the node adapter server
RUN npm install --omit=dev

EXPOSE 3000

ENV HOST=0.0.0.0
ENV PORT=3000

CMD ["node", "build"]
