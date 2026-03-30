# Project Memory: Immich-like Photo Management App

> This file is a Claude memory/context document. Paste it at the start of any new conversation to restore full project context.

---

## Project overview

Building a self-hosted photo and video management application inspired by Immich. The goal is a privacy-first, open-source alternative to Google Photos that users can run on their own server or a VPS.

**Core principles:**
- Runs on a Raspberry Pi or a cloud server (lightweight default config)
- Privacy-first: all data stays on the user's infrastructure
- Automatic background backup from mobile devices
- AI-powered smart search and face recognition (fully local, no cloud ML)

---

## System architecture

```
[Mobile app / Web app / CLI / Admin panel]
              ↓
    [API Gateway — Nginx + Auth middleware + Rate limiting]
              ↓
┌─────────────────────────────────────────────┐
│  Auth service  │  Asset service  │  Search service  │  Share service  │
└─────────────────────────────────────────────┘
              ↓                          ↓
    [Message queue — Redis/BullMQ]   [ML microservice — Python/FastAPI]
              ↓                          ↓
┌─────────────────────────────────────────────────────┐
│  File storage (S3/local)  │  PostgreSQL  │  pgvector  │  Redis cache  │
└─────────────────────────────────────────────────────┘
```

---

## Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Backend API | NestJS (TypeScript) | Modular, decorator-driven |
| ORM | Prisma | With migration support |
| Primary DB | PostgreSQL + pgvector | Metadata + vector similarity |
| Cache / Queue | Redis + BullMQ | Session cache, async job queue |
| ML microservice | FastAPI (Python) | CLIP + InsightFace, GPU-optional |
| File processing | Sharp (images), FFmpeg (video) | Thumbnail gen + HLS transcoding |
| File storage | S3-compatible (MinIO / AWS S3) | Abstracted from day 1 |
| Web frontend | SvelteKit (or Next.js) | Virtualized gallery grid |
| Mobile app | Flutter | iOS + Android, background sync |
| Reverse proxy | Nginx | TLS termination, auth middleware |
| Containerization | Docker Compose → Helm/k8s | Compose for dev, Helm for prod |
| Observability | Prometheus + Grafana | Metrics, dashboards |

---

## Development roadmap

### Phase 1 — Foundation (weeks 1–4)
- [ ] User auth with JWT (register, login, refresh tokens)
- [ ] REST API scaffold with NestJS
- [ ] Photo upload endpoint (chunked, with checksum dedup)
- [ ] PostgreSQL schema (core tables — see schema section below)
- [ ] Docker Compose dev environment (API + DB + Redis + Nginx)
- [ ] Web gallery grid (virtualized, date-grouped)
- [ ] Mobile upload screen (Flutter)

### Phase 2 — Media processing (weeks 5–8)
- [ ] Thumbnail generation with Sharp (multiple sizes: 240px, 720px)
- [ ] Video transcoding with FFmpeg (H.264 + HLS streaming)
- [ ] EXIF metadata extraction (date, GPS, camera model)
- [ ] HLS video streaming endpoint
- [ ] Storage abstraction layer (local filesystem + S3 driver)
- [ ] Background job queue with BullMQ (thumbnail, transcode, EXIF jobs)
- [ ] Job retry and failure handling

### Phase 3 — Organization & sharing (weeks 9–12)
- [ ] Albums (create, add/remove assets, cover photo)
- [ ] Favorites and archive
- [ ] Timeline view with date-based grouping
- [ ] Shareable public links (with optional password + expiry)
- [ ] Multi-user support with per-user libraries
- [ ] Trash bin with configurable retention period

### Phase 4 — AI & smart features (weeks 13–18)
- [ ] CLIP embedding generation (Python ML service)
- [ ] pgvector cosine similarity search ("beach sunset" → photos)
- [ ] Face detection with InsightFace
- [ ] Face vector clustering into person identities
- [ ] Named person albums (user labels clusters)
- [ ] Smart auto-albums (by location, date range, people)
- [ ] Map / geo view (GPS EXIF → leaflet.js map)
- [ ] Object/scene tagging via CLIP zero-shot classification

### Phase 5 — Mobile & sync (weeks 19–24) ✅
- [x] Automatic background backup (Android foreground service / iOS BGTaskScheduler)
- [x] Incremental sync (hash-based dedup, only upload new/changed files)
- [x] Offline thumbnail cache on device
- [x] Live photo / motion photo support
- [x] Push notifications (backup status, shared album activity)
- [x] iOS home screen widget (random memory photo)

### Phase 6 — Production hardening (ongoing)
- [ ] Prometheus metrics + Grafana dashboards
- [ ] Prisma-managed DB migrations
- [ ] Admin dashboard (user management, storage quotas, job monitor)
- [ ] Per-user storage quota enforcement
- [ ] OAuth2 / OIDC SSO (sign in with Google, Authentik, etc.)
- [ ] Helm chart for Kubernetes deployment
- [ ] Backup strategy docs (DB dumps + object storage replication)

---

## Core database schema

```sql
-- Users
users (id uuid PK, email, password_hash, name, profile_image_path,
       storage_quota_mb, is_admin, created_at, updated_at)

-- Assets (photos & videos)
assets (id uuid PK, owner_id FK→users, device_id, device_asset_id,
        original_path, preview_path, thumbnail_path,
        file_size_in_byte, mime_type, duration,
        file_created_at, file_modified_at, local_date_time,
        is_favorite, is_archived, is_deleted, deleted_at,
        checksum bytea UNIQUE,
        exif_data jsonb,  -- GPS, camera model, aperture, ISO, etc.
        type ENUM(IMAGE, VIDEO, AUDIO),
        created_at, updated_at)

-- CLIP embeddings for semantic search
asset_job_status (asset_id FK→assets, clip_embedding vector(512),
                  faces_recognized_at, clip_embedded_at, metadata_extracted_at)

-- Albums
albums (id uuid PK, owner_id FK→users, album_name, description,
        album_thumbnail_asset_id FK→assets, is_activity_enabled,
        created_at, updated_at)

album_assets (albums_id FK→albums, assets_id FK→assets, created_at)

albums_shared_users (albums_id FK→albums, users_id FK→users, role ENUM(VIEWER, EDITOR))

-- Face recognition
asset_faces (id uuid PK, asset_id FK→assets, person_id FK→people,
             bounding_box_x1 int, bounding_box_y1 int,
             bounding_box_x2 int, bounding_box_y2 int,
             embedding vector(512), image_width int, image_height int)

people (id uuid PK, owner_id FK→users, name, thumbnail_path,
        face_asset_id FK→asset_faces, birth_date date, created_at, updated_at)

-- Sharing
shared_links (id uuid PK, description, user_id FK→users,
              key varchar UNIQUE, type ENUM(ALBUM, INDIVIDUAL),
              password varchar, expires_at, allow_upload, allow_download,
              show_metadata, created_at)

-- Job queue (for tracking async processing)
jobs (id uuid PK, name, data jsonb, status ENUM(WAITING, ACTIVE, COMPLETED, FAILED),
      attempts int, created_at, processed_at, failed_at, failed_reason)
```

---

## Upload pipeline flow

```
Client (chunked multipart POST)
  → Asset service (validate, store original file, write DB row)
    → BullMQ: enqueue jobs in parallel →
        [thumbnail-generation] → Sharp → write preview + thumbnail paths to DB
        [metadata-extraction]  → exifr  → write exif_data jsonb to DB
        [video-transcoding]    → FFmpeg → write HLS segments + update duration
        [clip-embedding]       → HTTP POST to ML service → write vector to pgvector
        [face-detection]       → HTTP POST to ML service → write asset_faces rows
```

**Key constraint:** Never run ML synchronously in the HTTP request. All AI processing is async via the job queue.

---

## Smart search implementation

```
User query: "beach sunset"
  → Embed query with CLIP (same model as photo embeddings)
  → pgvector cosine similarity: SELECT * FROM asset_job_status
      ORDER BY clip_embedding <=> $queryVector LIMIT 50
  → Join with assets table for metadata
  → Return ranked results
```

---

## ML microservice endpoints (FastAPI)

```
POST /embed/image   { image_path: string } → { embedding: float[512] }
POST /embed/text    { text: string }       → { embedding: float[512] }
POST /detect/faces  { image_path: string } → { faces: [{ bbox, embedding }] }
GET  /health                               → { status: "ok", device: "cpu|cuda" }
```

Models used:
- **CLIP:** `openai/clip-vit-base-patch32` (via HuggingFace transformers)
- **Face detection:** InsightFace `buffalo_l` model
- **Scene tags:** CLIP zero-shot with a predefined label list

---

## Mobile auto-backup strategy

**Android:**
- Foreground service (required by OS for reliable background work)
- `WorkManager` for periodic sync when on WiFi + charging
- Track uploaded files via local SQLite table (`device_asset_id` = file URI hash)
- Chunked upload with resume support (track byte offset server-side)

**iOS:**
- `BGProcessingTask` for background uploads
- `PHPhotoLibrary` observer for new asset detection
- `URLSession` background task for uploads that survive app kill

**Dedup logic:** SHA-1 checksum of file bytes. Server rejects upload if checksum already exists in the user's library.

---

## Docker Compose services (dev)

```yaml
services:
  api:         # NestJS — port 3001
  ml:          # FastAPI — port 3003
  web:         # SvelteKit — port 3000
  postgres:    # PostgreSQL 16 with pgvector extension
  redis:       # Redis 7
  nginx:       # Reverse proxy — port 80/443
  minio:       # S3-compatible storage — port 9000 (optional, use local disk by default)
```

---

## Key engineering gotchas

1. **Timezone handling** — always store `file_created_at` in UTC, but store `local_date_time` (from EXIF) separately for display grouping. Photos shot at 11pm in Tokyo should group under that date, not UTC date.
2. **Virtualized gallery** — at 50,000+ photos, a naive grid will crash the browser. Use intersection observer or a lib like `svelte-virtual-list` / `react-window`.
3. **Chunked upload** — implement resumable uploads (tus protocol or custom). Mobile users on 4G will drop connections mid-upload.
4. **Storage abstraction** — code against a `StorageService` interface from day 1. Switching from local disk to S3 later without the abstraction is painful.
5. **Face clustering** — don't use k-means (requires knowing k). Use DBSCAN or HDBSCAN on the 512-dim face embeddings. Merge clusters when user says "same person."
6. **ML service cold start** — CLIP model load takes ~3s. Keep the ML service warm; don't spin it up per-request.
7. **Video HLS** — transcode to multiple quality levels (360p, 720p, 1080p) and serve an `.m3u8` manifest. Use FFmpeg's `-hls_time 6` segment size.

---

## File structure (monorepo)

```
/
├── apps/
│   ├── api/          # NestJS backend
│   ├── web/          # SvelteKit frontend
│   ├── mobile/       # Flutter app
│   └── ml/           # FastAPI ML microservice
├── packages/
│   ├── shared-types/ # TypeScript types shared between api + web
│   └── open-api/     # Generated API client
├── docker/
│   ├── docker-compose.yml
│   └── nginx/
├── helm/             # Helm chart for k8s
└── docs/
```

---

## Current status

- [ ] Phase 1 not yet started (API scaffold, auth, basic upload, web gallery)
- [x] Phase 5 — Mobile & Sync complete (2026-03-27)
  - Flutter app created at `apps/mobile/`
  - Backend: DeviceToken + UploadSession Prisma models, DevicesModule, NotificationsModule, MemoriesModule
  - New API endpoints: POST /devices/register, DELETE /devices/:token, GET /memories, POST /assets/check-hashes, POST/chunk/complete /assets/upload-session/:id, POST /assets/:id/live-video
  - Android: SyncForegroundService.kt, WorkManager config, AndroidManifest with all permissions
  - iOS: AppDelegate.swift with BGTaskScheduler registration, PhotoMemoriesWidget WidgetKit extension
  - Push notifications via Firebase (optional — activate by setting FIREBASE_SERVICE_ACCOUNT env var)
- Architecture and tech stack decided
- This memory file created on: 2026-03-24

---

*Paste this file at the top of a new Claude conversation to restore full project context. Update the "Current status" section as phases complete.*
