"""
PhotoApp ML Microservice — Phase 2.

Real implementations:
  - CLIP (openai/clip-vit-base-patch32) for image + text embeddings
  - CLIP zero-shot for scene tagging
  - InsightFace (buffalo_sc) for face detection
  - reverse-geocoder for offline GPS → city/country lookup
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Any

import reverse_geocoder as rg
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEVICE = os.environ.get("ML_DEVICE", "cpu")
EMBEDDING_DIM = 512

# ── Scene label vocabulary for CLIP zero-shot ──────────────────────────────
SCENE_LABELS = [
    "beach", "mountain", "forest", "city", "sunset", "sunrise", "snow",
    "desert", "lake", "river", "waterfall", "garden", "park", "street",
    "indoor", "food", "animal", "pet", "dog", "cat", "bird",
    "portrait", "selfie", "group photo", "wedding", "birthday party",
    "concert", "sports", "travel", "architecture", "night",
]

# ── Global model holders ────────────────────────────────────────────────────
clip_model: Any = None
clip_processor: Any = None
face_app: Any = None


def _load_clip() -> None:
    global clip_model, clip_processor
    logger.info("Loading CLIP model (openai/clip-vit-base-patch32)…")
    from transformers import CLIPModel, CLIPProcessor
    clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
    clip_model.eval()
    logger.info("CLIP model ready")


def _load_face() -> None:
    global face_app
    logger.info("Loading InsightFace (buffalo_sc)…")
    import insightface
    face_app = insightface.app.FaceAnalysis(
        name="buffalo_sc",
        providers=["CPUExecutionProvider"],
    )
    face_app.prepare(ctx_id=-1, det_size=(320, 320))
    logger.info("InsightFace ready")


@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, _load_clip)
    except Exception as e:
        logger.error(f"CLIP load failed: {e} — embedding endpoints will error")
    try:
        await loop.run_in_executor(None, _load_face)
    except Exception as e:
        logger.error(f"InsightFace load failed: {e} — face endpoints will return empty")
    yield


app = FastAPI(
    title="PhotoApp ML Service",
    description="CLIP embeddings, face detection, offline geocoding",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response models ───────────────────────────────────────────────

class TextEmbedRequest(BaseModel):
    text: str

class ImageEmbedRequest(BaseModel):
    image_path: str

class FaceDetectRequest(BaseModel):
    image_path: str

class SceneTagRequest(BaseModel):
    image_path: str

class GeocodeRequest(BaseModel):
    lat: float
    lng: float

class EmbeddingResponse(BaseModel):
    embedding: list[float]
    model: str
    device: str

class BoundingBox(BaseModel):
    x1: int
    y1: int
    x2: int
    y2: int

class FaceResult(BaseModel):
    bounding_box: BoundingBox
    embedding: list[float]
    confidence: float

class FaceDetectResponse(BaseModel):
    faces: list[FaceResult]
    model: str
    device: str

class SceneTag(BaseModel):
    tag: str
    confidence: float

class SceneTagResponse(BaseModel):
    tags: list[SceneTag]

class GeocodeResponse(BaseModel):
    city: str
    state: str
    country: str

class HealthResponse(BaseModel):
    status: str
    device: str
    version: str
    clip_loaded: bool
    face_loaded: bool


# ── Helpers ─────────────────────────────────────────────────────────────────

def _load_image(image_path: str) -> Image.Image:
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail=f"Image not found: {image_path}")
    return Image.open(image_path).convert("RGB")


def _clip_image_embedding(image: Image.Image) -> list[float]:
    import torch
    inputs = clip_processor(images=image, return_tensors="pt")
    with torch.no_grad():
        feats = clip_model.get_image_features(**inputs)
        feats = feats / feats.norm(dim=-1, keepdim=True)
    return feats[0].tolist()


def _clip_text_embedding(text: str) -> list[float]:
    import torch
    inputs = clip_processor(text=[text], return_tensors="pt", padding=True, truncation=True)
    with torch.no_grad():
        feats = clip_model.get_text_features(**inputs)
        feats = feats / feats.norm(dim=-1, keepdim=True)
    return feats[0].tolist()


# ── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        device=DEVICE,
        version="2.0.0",
        clip_loaded=clip_model is not None,
        face_loaded=face_app is not None,
    )


@app.post("/embed/text", response_model=EmbeddingResponse, tags=["embeddings"])
async def embed_text(request: TextEmbedRequest) -> EmbeddingResponse:
    if not request.text.strip():
        raise HTTPException(status_code=422, detail="text must not be empty")
    if clip_model is None:
        raise HTTPException(status_code=503, detail="CLIP model not loaded")

    loop = asyncio.get_event_loop()
    embedding = await loop.run_in_executor(None, _clip_text_embedding, request.text)
    return EmbeddingResponse(embedding=embedding, model="openai/clip-vit-base-patch32", device=DEVICE)


@app.post("/embed/image", response_model=EmbeddingResponse, tags=["embeddings"])
async def embed_image(request: ImageEmbedRequest) -> EmbeddingResponse:
    if clip_model is None:
        raise HTTPException(status_code=503, detail="CLIP model not loaded")

    image = _load_image(request.image_path)
    loop = asyncio.get_event_loop()
    embedding = await loop.run_in_executor(None, _clip_image_embedding, image)
    return EmbeddingResponse(embedding=embedding, model="openai/clip-vit-base-patch32", device=DEVICE)


@app.post("/detect/faces", response_model=FaceDetectResponse, tags=["faces"])
async def detect_faces(request: FaceDetectRequest) -> FaceDetectResponse:
    import numpy as np
    if face_app is None:
        return FaceDetectResponse(faces=[], model="insightface/buffalo_sc", device=DEVICE)

    image = _load_image(request.image_path)
    img_array = np.array(image)

    loop = asyncio.get_event_loop()
    raw_faces = await loop.run_in_executor(None, face_app.get, img_array)

    results: list[FaceResult] = []
    for face in raw_faces:
        bbox = face.bbox.astype(int).tolist()
        emb = face.embedding.tolist() if face.embedding is not None else [0.0] * EMBEDDING_DIM
        results.append(FaceResult(
            bounding_box=BoundingBox(x1=bbox[0], y1=bbox[1], x2=bbox[2], y2=bbox[3]),
            embedding=emb,
            confidence=float(face.det_score),
        ))

    return FaceDetectResponse(faces=results, model="insightface/buffalo_sc", device=DEVICE)


@app.post("/tag/scene", response_model=SceneTagResponse, tags=["tags"])
async def tag_scene(request: SceneTagRequest) -> SceneTagResponse:
    import torch
    if clip_model is None:
        raise HTTPException(status_code=503, detail="CLIP model not loaded")

    image = _load_image(request.image_path)

    def _run():
        inputs = clip_processor(
            text=SCENE_LABELS,
            images=image,
            return_tensors="pt",
            padding=True,
            truncation=True,
        )
        with torch.no_grad():
            outputs = clip_model(**inputs)
            logits = outputs.logits_per_image[0]
            probs = logits.softmax(dim=0).tolist()

        pairs = sorted(zip(SCENE_LABELS, probs), key=lambda x: x[1], reverse=True)
        # Return top-5 above 5% confidence
        return [{"tag": label, "confidence": round(conf, 4)}
                for label, conf in pairs[:5] if conf >= 0.05]

    loop = asyncio.get_event_loop()
    tags = await loop.run_in_executor(None, _run)
    return SceneTagResponse(tags=[SceneTag(**t) for t in tags])


@app.post("/geocode", response_model=GeocodeResponse, tags=["geo"])
async def geocode(request: GeocodeRequest) -> GeocodeResponse:
    results = rg.search([(request.lat, request.lng)], verbose=False)
    if not results:
        raise HTTPException(status_code=404, detail="Location not found")
    r = results[0]
    return GeocodeResponse(
        city=r.get("name", ""),
        state=r.get("admin1", ""),
        country=r.get("cc", ""),
    )
