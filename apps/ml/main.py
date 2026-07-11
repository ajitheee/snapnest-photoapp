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
import io
import logging
import os
from contextlib import asynccontextmanager
from typing import Any, Optional

import numpy as np
import pillow_heif
import reverse_geocoder as rg
from fastapi import FastAPI, HTTPException

pillow_heif.register_heif_opener()
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEVICE = os.environ.get("ML_DEVICE", "cpu")
EMBEDDING_DIM = 512

# ── Scene label vocabulary for CLIP zero-shot ──────────────────────────────
SCENE_LABELS = [
    # Nature / Landscape
    "beach", "mountain", "forest", "city", "sunset", "sunrise", "snow",
    "desert", "lake", "river", "waterfall", "garden", "park", "street",
    "ocean", "field", "countryside", "island", "cave", "cliff",
    "volcano", "glacier", "coral reef", "aurora borealis", "canyon",
    "meadow", "swamp", "rainforest", "savanna", "tundra", "valley",
    "hills", "coastline", "peninsula", "archipelago", "hot spring",
    # Indoor / Scenes
    "indoor", "office", "restaurant", "cafe", "kitchen", "bedroom",
    "classroom", "gym", "museum", "library", "church", "temple",
    "airport", "train station", "shopping mall", "hospital",
    "bathroom", "garage", "laundry room", "basement", "attic",
    "living room", "dining room", "hallway", "staircase", "elevator",
    "bar", "nightclub", "spa", "salon", "lobby", "theater",
    "cinema", "studio", "workshop", "laboratory", "warehouse",
    # Food & Drink
    "food", "meal", "dessert", "coffee", "cocktail", "fruit",
    "sushi", "pizza", "burger", "salad", "pasta", "steak",
    "sandwich", "soup", "barbecue", "seafood", "breakfast",
    "brunch", "ice cream", "chocolate", "cheese", "bread",
    "wine", "beer", "smoothie", "juice", "tea", "cake",
    "cookies", "pie", "cupcake", "donut", "pancakes", "tacos",
    # Animals
    "animal", "pet", "dog", "cat", "bird", "horse", "fish",
    "golden retriever", "labrador", "german shepherd", "poodle", "bulldog",
    "husky", "corgi", "beagle", "dalmatian", "chihuahua",
    "tabby cat", "siamese cat", "persian cat", "kitten", "puppy",
    "parrot", "eagle", "owl", "flamingo", "penguin", "swan",
    "dolphin", "whale", "shark", "turtle", "frog", "lizard",
    "snake", "butterfly", "bee", "spider", "rabbit", "hamster",
    "squirrel", "deer", "bear", "wolf", "fox", "lion",
    "tiger", "elephant", "giraffe", "zebra", "monkey", "gorilla",
    "panda", "koala", "kangaroo", "duck", "chicken", "cow",
    "pig", "sheep", "goat",
    # People / Events
    "portrait", "selfie", "group photo", "wedding", "birthday party",
    "concert", "sports", "graduation", "conference", "meeting",
    "family", "children", "baby",
    "anniversary", "engagement", "proposal", "ceremony",
    "halloween", "thanksgiving", "christmas", "new year", "easter",
    "valentines day", "mothers day", "fathers day", "independence day",
    "carnival", "festival", "parade", "funeral", "baptism",
    "baby shower", "gender reveal", "prom", "reunion", "retirement",
    # Activities
    "travel", "hiking", "swimming", "cycling", "running", "dancing",
    "cooking", "reading", "gaming",
    "skiing", "snowboarding", "surfing", "skateboarding", "yoga",
    "meditation", "fishing", "camping", "climbing", "kayaking",
    "sailing", "diving", "scuba diving", "snorkeling", "paragliding",
    "skydiving", "bungee jumping", "rafting", "horseback riding",
    "golfing", "tennis", "basketball", "football", "soccer",
    "baseball", "volleyball", "boxing", "martial arts", "wrestling",
    "weightlifting", "CrossFit", "pilates", "gardening", "painting",
    "drawing", "pottery", "knitting", "sewing", "woodworking",
    "photography", "birdwatching", "stargazing", "shopping",
    # Objects / Tech
    "car", "motorcycle", "bicycle", "airplane", "boat", "train",
    "phone", "laptop", "headphones", "earbuds", "camera", "book",
    "flowers", "christmas tree", "gift", "cake",
    "helicopter", "yacht", "scooter", "bus", "truck", "van",
    "sports car", "vintage car", "taxi", "ambulance", "fire truck",
    "rocket", "satellite", "drone", "jet ski", "canoe",
    "watch", "jewelry", "ring", "necklace", "sunglasses",
    "hat", "shoes", "sneakers", "dress", "suit", "handbag",
    "backpack", "umbrella", "tent", "surfboard", "skateboard",
    "guitar", "piano", "violin", "drums", "microphone",
    "television", "gaming console", "robot", "telescope", "microscope",
    # Documents / Text
    "document", "receipt", "whiteboard", "sign", "menu",
    "letter", "newspaper", "magazine", "poster", "billboard",
    "business card", "id card", "passport", "ticket", "boarding pass",
    "handwriting", "note", "postcard", "envelope", "label",
    "qr code", "barcode", "screenshot", "map", "chart", "diagram",
    # Architecture / Structure
    "architecture", "building", "bridge", "monument", "skyscraper",
    "house", "castle", "tower",
    "mosque", "pagoda", "lighthouse", "windmill", "cathedral",
    "palace", "fortress", "ruins", "pyramid", "colosseum",
    "statue", "fountain", "gate", "arch", "dome",
    "cabin", "cottage", "villa", "mansion", "apartment",
    "barn", "silo", "greenhouse", "gazebo", "pier", "dock",
    # Vehicles / Transport
    "subway", "tram", "ferry", "cruise ship", "hot air balloon",
    "cable car", "gondola", "rickshaw", "horse carriage",
    # Time / Conditions
    "night", "cloudy", "rainy", "foggy", "autumn", "spring",
    "summer", "winter", "golden hour", "blue hour", "overcast",
    "stormy", "windy", "sunny", "hazy", "misty", "snowy",
    "rainbow", "lightning", "tornado", "hurricane",
    # Art / Style
    "black and white", "aerial view", "panorama", "macro", "underwater",
    "fireworks", "reflection", "shadow", "silhouette",
    "long exposure", "bokeh", "double exposure", "abstract",
    "minimalist", "vintage", "retro", "graffiti", "mural",
    "sculpture", "mosaic", "stained glass", "neon", "light painting",
    "drone shot", "flatlay", "time lapse", "symmetry", "pattern",
    "texture", "close up", "wide angle", "fisheye",
    # Miscellaneous
    "workspace", "home office", "coworking", "school", "university",
    "playground", "amusement park", "zoo", "aquarium", "botanical garden",
    "vineyard", "farm", "orchard", "market", "bazaar",
    "cemetery", "memorial", "rooftop", "balcony", "terrace",
    "pool", "jacuzzi", "sauna", "waterpark", "ski resort",
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
    loop = asyncio.get_running_loop()
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

class FaceClusterInput(BaseModel):
    face_id: str
    embedding: list[float]

class ClusterResult(BaseModel):
    face_id: str
    cluster_id: int

class FaceClusterRequest(BaseModel):
    faces: list[FaceClusterInput]
    threshold: float = 0.38

class FaceClusterResponse(BaseModel):
    clusters: list[ClusterResult]
    num_clusters: int

class FaceClusterBinaryRequest(BaseModel):
    face_ids: list[str]
    embeddings_b64: str
    dim: int = 512
    threshold: float = 0.45


class HealthResponse(BaseModel):
    status: str
    device: str
    version: str
    clip_loaded: bool
    face_loaded: bool


# ── Helpers ─────────────────────────────────────────────────────────────────

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/uploads")
THUMBNAIL_DIR = os.environ.get("THUMBNAIL_DIR", "/thumbnails")

def _resolve_image_path(image_path: str) -> str:
    if os.path.isabs(image_path) and os.path.exists(image_path):
        return image_path
    if image_path.startswith("originals/"):
        candidate = os.path.join(UPLOAD_DIR, image_path.removeprefix("originals/"))
        if os.path.exists(candidate):
            return candidate
    if image_path.startswith("thumbnails/"):
        candidate = os.path.join(THUMBNAIL_DIR, image_path.removeprefix("thumbnails/"))
        if os.path.exists(candidate):
            return candidate
    for base in [UPLOAD_DIR, THUMBNAIL_DIR, "/app"]:
        candidate = os.path.join(base, image_path)
        if os.path.exists(candidate):
            return candidate
    return image_path

def _load_image(image_path: str) -> Image.Image:
    resolved = _resolve_image_path(image_path)
    if not os.path.exists(resolved):
        raise HTTPException(status_code=404, detail=f"Image not found: {image_path}")
    return Image.open(resolved).convert("RGB")


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

    loop = asyncio.get_running_loop()
    embedding = await loop.run_in_executor(None, _clip_text_embedding, request.text)
    return EmbeddingResponse(embedding=embedding, model="openai/clip-vit-base-patch32", device=DEVICE)


@app.post("/embed/image", response_model=EmbeddingResponse, tags=["embeddings"])
async def embed_image(request: ImageEmbedRequest) -> EmbeddingResponse:
    if clip_model is None:
        raise HTTPException(status_code=503, detail="CLIP model not loaded")

    image = _load_image(request.image_path)
    loop = asyncio.get_running_loop()
    embedding = await loop.run_in_executor(None, _clip_image_embedding, image)
    return EmbeddingResponse(embedding=embedding, model="openai/clip-vit-base-patch32", device=DEVICE)


@app.post("/detect/faces", response_model=FaceDetectResponse, tags=["faces"])
async def detect_faces(request: FaceDetectRequest) -> FaceDetectResponse:
    import numpy as np
    if face_app is None:
        return FaceDetectResponse(faces=[], model="insightface/buffalo_sc", device=DEVICE)

    image = _load_image(request.image_path)
    img_array = np.array(image)

    loop = asyncio.get_running_loop()
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
        # Return top-8 above 2% confidence for broader coverage
        return [{"tag": label, "confidence": round(conf, 4)}
                for label, conf in pairs[:8] if conf >= 0.02]

    loop = asyncio.get_running_loop()
    tags = await loop.run_in_executor(None, _run)
    return SceneTagResponse(tags=[SceneTag(**t) for t in tags])


@app.post("/cluster/faces", response_model=FaceClusterResponse, tags=["faces"])
async def cluster_faces(request: FaceClusterRequest) -> FaceClusterResponse:
    import numpy as np

    if len(request.faces) == 0:
        return FaceClusterResponse(clusters=[], num_clusters=0)

    if len(request.faces) == 1:
        return FaceClusterResponse(
            clusters=[ClusterResult(face_id=request.faces[0].face_id, cluster_id=0)],
            num_clusters=1
        )

    def _cluster():
        from sklearn.cluster import DBSCAN
        embeddings = np.array([f.embedding for f in request.faces], dtype=np.float32)
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        embeddings = embeddings / np.maximum(norms, 1e-10)

        dbscan = DBSCAN(
            eps=request.threshold,
            min_samples=2,
            metric='cosine',
            n_jobs=1,
        )
        labels = dbscan.fit_predict(embeddings)
        return labels.tolist()

    loop = asyncio.get_running_loop()
    labels = await loop.run_in_executor(None, _cluster)

    clusters = [
        ClusterResult(face_id=f.face_id, cluster_id=int(label))
        for f, label in zip(request.faces, labels)
    ]
    num_clusters = len(set(l for l in labels if l >= 0))
    return FaceClusterResponse(clusters=clusters, num_clusters=num_clusters)



@app.post("/cluster/faces/binary", response_model=FaceClusterResponse, tags=["faces"])
async def cluster_faces_binary(request: FaceClusterBinaryRequest) -> FaceClusterResponse:
    import base64
    if len(request.face_ids) == 0:
        return FaceClusterResponse(clusters=[], num_clusters=0)
    if len(request.face_ids) == 1:
        return FaceClusterResponse(
            clusters=[ClusterResult(face_id=request.face_ids[0], cluster_id=0)],
            num_clusters=1
        )
    def _cluster_bin():
        raw = base64.b64decode(request.embeddings_b64)
        embeddings = np.frombuffer(raw, dtype=np.float32).reshape(len(request.face_ids), request.dim).copy()
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        embeddings /= np.maximum(norms, 1e-10)
        from sklearn.cluster import DBSCAN
        labels = DBSCAN(eps=request.threshold, min_samples=2, metric="cosine", n_jobs=1).fit_predict(embeddings)
        return labels.tolist()
    loop = asyncio.get_running_loop()
    labels = await loop.run_in_executor(None, _cluster_bin)
    clusters = [ClusterResult(face_id=fid, cluster_id=int(lbl))
                for fid, lbl in zip(request.face_ids, labels)]
    num_clusters = len(set(l for l in labels if l >= 0))
    return FaceClusterResponse(clusters=clusters, num_clusters=num_clusters)

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


# ── Photo / Video Editing ────────────────────────────────────────────────────

class EditCropRegion(BaseModel):
    left: float    # 0.0–1.0 fraction of image width
    top: float
    width: float
    height: float

class EditOperations(BaseModel):
    # Rotation (degrees): 0, 90, 180, 270 — applied before crop
    rotation: int = 0

    # Straighten / Perspective / Flip (Phase 4)
    straighten: float = 0.0         # -45..45 degrees fine rotation
    perspective_v: float = 0.0      # -1..1 vertical perspective correction
    perspective_h: float = 0.0      # -1..1 horizontal perspective correction
    flip_horizontal: bool = False
    flip_vertical: bool = False
    aspect_ratio: Optional[str] = None  # "1:1", "4:3", "16:9", "3:2", "9:16", "free"

    # Actions
    crop: Optional[EditCropRegion] = None
    unblur: float = 0.0        # 0..1 intensity
    portrait_blur: float = 0.0 # 0..1 intensity
    pop: float = 0.0           # 0..1 intensity
    magic_eraser: Optional[EditCropRegion] = None

    # Filters
    filter: str = "none"
    filter_intensity: float = 1.0  # 0..1, blends between original and full filter
    sky_style: str = "none"
    sky_intensity: float = 1.0

    # Lighting
    hdr: bool = False
    portrait_light: bool = False
    brightness: float = 0.0   # -1..1
    contrast: float = 0.0     # -1..1
    tone: float = 0.0         # -1..1 (midtone shift)
    white_point: float = 1.0  # 0.5..1.0
    black_point: float = 0.0  # 0..0.5
    highlights: float = 0.0   # -1..1
    shadows: float = 0.0      # -1..1
    vignette: float = 0.0     # 0..1

    # Colors
    saturation: float = 0.0   # -1..1
    warmth: float = 0.0       # -1..1 (cool→warm)
    tint: float = 0.0         # -1..1 (magenta→green)
    skin_tone: float = 0.0    # -1..1
    blue_tone: float = 0.0    # -1..1

class EditImageRequest(BaseModel):
    image_path: str
    operations: EditOperations
    quality: int = 90


# ── OCR ────────────────────────────────────────────────────────────────────────

class OcrRequest(BaseModel):
    image_path: str

class OcrResponse(BaseModel):
    text: str
    confidence: float

@app.post("/ocr", response_model=OcrResponse, tags=["ocr"])
async def ocr(request: OcrRequest) -> OcrResponse:
    import pytesseract

    image = _load_image(request.image_path)

    def _run_ocr():
        data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
        words = []
        confidences = []
        for i, text in enumerate(data["text"]):
            conf = int(data["conf"][i])
            if conf > 30 and text.strip():
                words.append(text.strip())
                confidences.append(conf)
        full_text = " ".join(words)
        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
        return full_text, avg_conf / 100.0

    loop = asyncio.get_running_loop()
    text, confidence = await loop.run_in_executor(None, _run_ocr)
    return OcrResponse(text=text, confidence=round(confidence, 4))


# ── Perceptual Hashing ─────────────────────────────────────────────────────────

class PHashRequest(BaseModel):
    image_path: str

class PHashResponse(BaseModel):
    hash: str

@app.post("/phash", response_model=PHashResponse, tags=["duplicates"])
async def compute_phash(request: PHashRequest) -> PHashResponse:
    import imagehash

    image = _load_image(request.image_path)

    def _compute():
        return str(imagehash.phash(image, hash_size=16))

    loop = asyncio.get_running_loop()
    h = await loop.run_in_executor(None, _compute)
    return PHashResponse(hash=h)


# ── Edit helpers ─────────────────────────────────────────────────────────────

def _edit_load_image(image_path: str) -> Image.Image:
    resolved = _resolve_image_path(image_path)
    if not os.path.exists(resolved):
        raise HTTPException(status_code=404, detail=f"Image not found: {image_path}")
    try:
        img = Image.open(resolved)
        img = ImageOps.exif_transpose(img)
        img.load()
        return img.convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Cannot open image: {e}")


def _action_unblur(img: Image.Image, intensity: float = 1.0) -> Image.Image:
    t = max(0.0, min(1.0, intensity))
    # Two-pass sharpening for stronger effect at high intensities
    radius    = 1.5 + t * 4.0      # 1.5..5.5
    percent   = 120 + int(t * 280) # 120..400
    threshold = max(1, 3 - int(t * 2))  # 3..1
    result = img.filter(ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=threshold))
    if t > 0.5:
        # Second lighter pass for extra crispness at higher intensities
        result = result.filter(ImageFilter.UnsharpMask(radius=0.5, percent=int(t * 80), threshold=1))
    return result


def _action_portrait_blur(img: Image.Image, intensity: float = 1.0) -> Image.Image:
    """Blur background while keeping detected faces sharp."""
    t = max(0.0, min(1.0, intensity))
    blur_radius = 2.0 + t * 20.0  # 2..22

    if face_app is None:
        return img.filter(ImageFilter.GaussianBlur(radius=blur_radius * 1.5))

    arr = np.array(img)
    faces = face_app.get(arr)

    if not faces:
        # No faces: apply uniform blur scaled by intensity
        return img.filter(ImageFilter.GaussianBlur(radius=blur_radius * 1.5))

    import cv2

    h, w = arr.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    for face in faces:
        bbox = face.bbox.astype(int)
        x1 = max(0, bbox[0] - 25)
        y1 = max(0, bbox[1] - 50)
        x2 = min(w, bbox[2] + 25)
        y2 = min(h, bbox[3] + 25)
        mask[y1:y2, x1:x2] = 255

    mask_soft = cv2.GaussianBlur(mask, (61, 61), 0).astype(np.float32) / 255.0
    blurred = np.array(img.filter(ImageFilter.GaussianBlur(radius=blur_radius)))
    mask3 = np.stack([mask_soft] * 3, axis=-1)
    composite = (arr * mask3 + blurred * (1.0 - mask3)).astype(np.uint8)
    return Image.fromarray(composite)


def _action_pop(img: Image.Image, intensity: float = 1.0) -> Image.Image:
    """Auto-enhance contrast (CLAHE on L channel) + saturation boost scaled by intensity."""
    import cv2
    t = max(0.0, min(1.0, intensity))
    arr = np.array(img)
    lab = cv2.cvtColor(arr, cv2.COLOR_RGB2LAB)
    clip_limit = 1.0 + t * 3.0   # 1..4
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(8, 8))
    lab[:, :, 0] = clahe.apply(lab[:, :, 0])
    enhanced = Image.fromarray(cv2.cvtColor(lab, cv2.COLOR_LAB2RGB))
    color_factor = 1.0 + t * 0.65  # 1.0..1.65
    return ImageEnhance.Color(enhanced).enhance(color_factor)


def _action_magic_eraser(img: Image.Image, region: EditCropRegion) -> Image.Image:
    """Inpaint a selected region using OpenCV Telea method."""
    import cv2
    arr = np.array(img.convert("RGB"))
    mask = np.zeros(arr.shape[:2], dtype=np.uint8)
    t, l, h, w = region.top, region.left, region.height, region.width
    mask[t: t + h, l: l + w] = 255
    result = cv2.inpaint(arr, mask, inpaintRadius=7, flags=cv2.INPAINT_TELEA)
    return Image.fromarray(result)


def _curves(arr: np.ndarray, pts: list) -> np.ndarray:
    """Apply a tone curve defined by (in, out) control points to a float32 array."""
    xs = np.array([p[0] for p in pts], dtype=np.float32)
    ys = np.array([p[1] for p in pts], dtype=np.float32)
    lut = np.interp(np.arange(256, dtype=np.float32), xs, ys)
    flat = np.clip(arr, 0, 255).astype(np.uint8)
    return lut[flat].astype(np.float32)


def _split_tone(arr: np.ndarray, shadow_rgb: tuple, highlight_rgb: tuple, strength: float = 0.25) -> np.ndarray:
    """Add warm/cool split toning: shadow_rgb applied to darks, highlight_rgb to brights."""
    lum = arr.mean(axis=2, keepdims=True) / 255.0
    shadow_w    = np.clip(1.0 - lum * 2.5, 0, 1)
    highlight_w = np.clip(lum * 2.5 - 1.5, 0, 1)
    result = arr.copy()
    for c, (sc, hc) in enumerate(zip(shadow_rgb, highlight_rgb)):
        result[:, :, c] = np.clip(
            arr[:, :, c]
            + shadow_w[:, :, 0]    * sc * strength * 255
            + highlight_w[:, :, 0] * hc * strength * 255,
            0, 255
        )
    return result


def _apply_filter_full(img: Image.Image, name: str) -> Image.Image:
    arr = np.array(img.convert("RGB"), dtype=np.float32)

    if name == "vivid":
        # Aggressive S-curve + mega saturation + contrast punch
        arr = _curves(arr, [(0,0),(55,35),(128,145),(200,228),(255,255)])
        img2 = ImageEnhance.Color(Image.fromarray(np.clip(arr,0,255).astype(np.uint8))).enhance(2.3)
        return ImageEnhance.Contrast(img2).enhance(1.35)

    elif name == "dramatic":
        # Crushed blacks, blown highlights, strong desaturation
        arr = _curves(arr, [(0,0),(45,10),(100,72),(160,180),(215,245),(255,255)])
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        img2 = ImageEnhance.Color(img2).enhance(0.3)
        return ImageEnhance.Contrast(img2).enhance(1.85)

    elif name == "mono":
        # B&W with punchy contrast curve
        gray = np.array(ImageOps.grayscale(img).convert("RGB"), dtype=np.float32)
        gray = _curves(gray, [(0,0),(60,40),(128,130),(200,225),(255,255)])
        return Image.fromarray(np.clip(gray, 0, 255).astype(np.uint8))

    elif name == "silvertone":
        # Rich silver-toned B&W: warm highlights, cool midtones
        gray = np.array(ImageOps.grayscale(img).convert("RGB"), dtype=np.float32)
        gray = _curves(gray, [(0,5),(80,70),(128,130),(200,215),(255,248)])
        gray[:, :, 0] = np.clip(gray[:, :, 0] * 1.12 + 8,  0, 255)   # warm R lift
        gray[:, :, 1] = np.clip(gray[:, :, 1] * 1.00 + 2,  0, 255)
        gray[:, :, 2] = np.clip(gray[:, :, 2] * 0.82 + 12, 0, 255)   # cool B pull
        return Image.fromarray(np.clip(gray, 0, 255).astype(np.uint8))

    elif name == "playa":
        # Sun-bleached warm fade — heavy lift, blue mostly gone
        arr = _curves(arr, [(0,35),(128,138),(255,230)])
        arr[:, :, 0] = np.clip(arr[:, :, 0] * 1.22 + 18, 0, 255)
        arr[:, :, 1] = np.clip(arr[:, :, 1] * 1.10 + 10, 0, 255)
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 0.55 + 15, 0, 255)
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        return ImageEnhance.Color(img2).enhance(0.65)

    elif name == "honey":
        # Deep amber gold — strong red/green, crush blue
        arr[:, :, 0] = np.clip(arr[:, :, 0] * 1.35 + 18, 0, 255)
        arr[:, :, 1] = np.clip(arr[:, :, 1] * 1.15 + 5,  0, 255)
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 0.42,       0, 255)
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        return ImageEnhance.Color(img2).enhance(1.3)

    elif name == "clarendon":
        # Deep teal shadows, vivid saturation, strong S-curve
        arr = _curves(arr, [(0,0),(70,45),(128,152),(195,228),(255,255)])
        arr = _split_tone(arr, shadow_rgb=(-0.15,-0.08,0.28), highlight_rgb=(0.08,0.04,-0.08), strength=0.55)
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        return ImageEnhance.Color(img2).enhance(1.75)

    elif name == "juno":
        # Bold teal shadows, gold highlights, saturated
        arr = _split_tone(arr, shadow_rgb=(-0.12,0.12,0.22), highlight_rgb=(0.28,0.12,-0.18), strength=0.6)
        arr = _curves(arr, [(0,8),(100,110),(180,198),(255,250)])
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        return ImageEnhance.Color(img2).enhance(1.5)

    elif name == "lark":
        # Bright airy landscape — strong brightness lift + cool blue
        arr = _curves(arr, [(0,15),(90,118),(170,200),(255,248)])
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 1.18 + 14, 0, 255)
        arr[:, :, 1] = np.clip(arr[:, :, 1] * 1.06 + 4,  0, 255)
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        return ImageEnhance.Color(img2).enhance(1.25)

    elif name == "aden":
        # Strong matte fade — heavy blue/teal cast, very desaturated
        arr = _curves(arr, [(0,28),(128,142),(255,232)])
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 1.18 + 22, 0, 255)
        arr[:, :, 0] = np.clip(arr[:, :, 0] * 0.92,       0, 255)
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        img2 = ImageEnhance.Color(img2).enhance(0.5)
        return ImageEnhance.Brightness(img2).enhance(1.08)

    elif name == "nashville":
        # Strong warm-pink vintage — heavy red + lifted blue shadows
        arr[:, :, 0] = np.clip(arr[:, :, 0] * 1.32 + 22, 0, 255)
        arr[:, :, 1] = np.clip(arr[:, :, 1] * 0.90 + 5,  0, 255)
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 0.80 + 30, 0, 255)
        arr = _curves(arr, [(0,25),(128,138),(255,242)])
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        return ImageEnhance.Color(img2).enhance(0.78)

    elif name == "chrome":
        # Hard silver: blown contrast, strong desaturation, blue-tinted shadows
        arr = _curves(arr, [(0,0),(40,8),(100,80),(170,210),(220,248),(255,255)])
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 1.18 + 12, 0, 255)
        arr[:, :, 0] = np.clip(arr[:, :, 0] * 0.94,       0, 255)
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        img2 = ImageEnhance.Contrast(img2).enhance(1.6)
        return ImageEnhance.Color(img2).enhance(0.38)

    elif name == "fade":
        # Heavy film fade: very lifted blacks, pulled whites, warm desaturated
        arr = _curves(arr, [(0,45),(100,110),(200,195),(255,218)])
        arr[:, :, 0] = np.clip(arr[:, :, 0] * 1.10 + 8, 0, 255)
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 0.90,     0, 255)
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        return ImageEnhance.Color(img2).enhance(0.55)

    elif name == "cinematic":
        # Strong orange-teal grade + deep vignette
        arr = _split_tone(arr, shadow_rgb=(-0.18,0.15,0.30), highlight_rgb=(0.32,0.08,-0.22), strength=0.65)
        arr = _curves(arr, [(0,0),(60,38),(128,122),(195,218),(255,255)])
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        img2 = ImageEnhance.Color(img2).enhance(0.65)
        img2 = ImageEnhance.Contrast(img2).enhance(1.45)
        h, w = np.array(img2).shape[:2]
        Y, X = np.ogrid[:h, :w]
        dist = np.sqrt(((X - w/2) / (w/2))**2 + ((Y - h/2) / (h/2))**2)
        vignette = np.clip(1.0 - dist * 0.72, 0.35, 1.0)
        out = np.array(img2, dtype=np.float32) * vignette[:, :, np.newaxis]
        return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

    elif name == "warm":
        # Strong golden warmth — noticeable red/yellow push, crush blue
        arr[:, :, 0] = np.clip(arr[:, :, 0] * 1.28 + 20, 0, 255)
        arr[:, :, 1] = np.clip(arr[:, :, 1] * 1.08 + 8,  0, 255)
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 0.68,       0, 255)
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        return ImageEnhance.Color(img2).enhance(1.25)

    elif name == "cool":
        # Icy blue — strong blue push, pull red, slight desaturate
        arr[:, :, 0] = np.clip(arr[:, :, 0] * 0.78,       0, 255)
        arr[:, :, 1] = np.clip(arr[:, :, 1] * 1.04 + 5,  0, 255)
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 1.32 + 18, 0, 255)
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        return ImageEnhance.Color(img2).enhance(0.82)

    elif name in ("noir", "tonal"):
        # B&W: noir = punchy contrast, tonal = softer
        gray = np.array(ImageOps.grayscale(img).convert("RGB"), dtype=np.float32)
        if name == "noir":
            gray = _curves(gray, [(0,0),(50,30),(128,138),(210,232),(255,255)])
        else:
            gray = _curves(gray, [(0,10),(80,78),(128,132),(200,210),(255,248)])
        return Image.fromarray(np.clip(gray, 0, 255).astype(np.uint8))

    elif name == "matte":
        # Lifted blacks, muted highlights, desaturated
        arr = _curves(arr, [(0,30),(128,130),(255,220)])
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        return ImageEnhance.Color(img2).enhance(0.7)

    elif name == "film":
        # Film: warm fade + slight grain
        arr = _curves(arr, [(0,15),(90,105),(180,195),(255,235)])
        arr[:, :, 0] = np.clip(arr[:, :, 0] * 1.12 + 10, 0, 255)
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 0.80,      0, 255)
        noise = np.random.normal(0, 4, arr.shape).astype(np.float32)
        arr = arr + noise
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        return ImageEnhance.Color(img2).enhance(0.85)

    elif name == "vintage":
        # Warm sepia with lifted shadows
        arr = _curves(arr, [(0,20),(128,135),(255,230)])
        arr[:, :, 0] = np.clip(arr[:, :, 0] * 1.18 + 12, 0, 255)
        arr[:, :, 1] = np.clip(arr[:, :, 1] * 1.05 + 5,  0, 255)
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 0.70 + 15, 0, 255)
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        return ImageEnhance.Color(img2).enhance(0.80)

    elif name == "instant":
        # High contrast, punchy, slightly desaturated
        arr = _curves(arr, [(0,0),(50,30),(128,145),(200,230),(255,255)])
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        img2 = ImageEnhance.Contrast(img2).enhance(1.5)
        return ImageEnhance.Color(img2).enhance(0.85)

    elif name == "process":
        # Cross-process: blue/cyan shadows, warm highlights
        arr = _split_tone(arr, shadow_rgb=(-0.25, 0.15, 0.40), highlight_rgb=(0.30, 0.05, -0.20), strength=0.7)
        arr = _curves(arr, [(0,0),(60,45),(128,140),(195,225),(255,255)])
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        return ImageEnhance.Contrast(img2).enhance(1.3)

    elif name == "transfer":
        # Photo transfer: warm faded with slight blur softness
        arr = _curves(arr, [(0,28),(100,112),(200,198),(255,225)])
        arr[:, :, 0] = np.clip(arr[:, :, 0] * 1.10 + 15, 0, 255)
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 0.75,      0, 255)
        img2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        img2 = img2.filter(ImageFilter.GaussianBlur(radius=0.4))
        return ImageEnhance.Color(img2).enhance(0.75)

    return img


def _apply_filter(img: Image.Image, name: str, intensity: float = 1.0) -> Image.Image:
    """Apply named filter at given intensity (0=original, 1=full effect)."""
    t = max(0.0, min(1.0, intensity))
    filtered = _apply_filter_full(img, name)
    if t >= 0.99:
        return filtered
    orig = np.array(img.convert("RGB"), dtype=np.float32)
    filt = np.array(filtered.convert("RGB"), dtype=np.float32)
    blended = orig * (1.0 - t) + filt * t
    return Image.fromarray(np.clip(blended, 0, 255).astype(np.uint8))


def _apply_hdr_np(arr: np.ndarray) -> np.ndarray:
    """Simulate HDR look via per-channel CLAHE + light contrast boost."""
    import cv2
    u8 = np.clip(arr, 0, 255).astype(np.uint8)
    lab = cv2.cvtColor(u8, cv2.COLOR_RGB2LAB)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    lab[:, :, 0] = clahe.apply(lab[:, :, 0])
    result = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB).astype(np.float32)
    return (result - 128.0) * 1.15 + 128.0


def _apply_portrait_light_np(arr: np.ndarray) -> np.ndarray:
    """Soft spotlight around detected faces; falls back to a subtle centre-vignette."""
    if face_app is None:
        # Fallback: brighten centre, darken edges
        h, w = arr.shape[:2]
        cx, cy = w / 2, h / 2
        y_idx, x_idx = np.ogrid[:h, :w]
        dist = np.sqrt((x_idx - cx) ** 2 + (y_idx - cy) ** 2)
        max_d = np.sqrt(cx ** 2 + cy ** 2)
        light = 1.0 + 0.25 * (1.0 - np.clip(dist / max_d, 0, 1))
        return np.clip(arr * np.stack([light] * 3, axis=-1), 0, 255)

    u8 = np.clip(arr, 0, 255).astype(np.uint8)
    tmp_img = Image.fromarray(u8)
    import cv2
    faces = face_app.get(np.array(tmp_img))
    if not faces:
        return arr

    h, w = arr.shape[:2]
    light_map = np.ones((h, w), dtype=np.float32)
    for face in faces:
        bbox = face.bbox.astype(int)
        cx = (bbox[0] + bbox[2]) / 2
        cy = (bbox[1] + bbox[3]) / 2
        radius = max(bbox[2] - bbox[0], bbox[3] - bbox[1]) * 1.6
        y_idx, x_idx = np.ogrid[:h, :w]
        dist = np.sqrt((x_idx - cx) ** 2 + (y_idx - cy) ** 2)
        spot = 1.0 + 0.3 * np.exp(-0.5 * (dist / radius) ** 2)
        light_map = np.maximum(light_map, spot)

    light3 = np.stack([light_map] * 3, axis=-1)
    return np.clip(arr * light3, 0, 255)


def _apply_sky_style_np(arr: np.ndarray, style: str) -> np.ndarray:
    """Sky colour grading applied to the top third of the image."""
    h = arr.shape[0]
    top = arr[:h // 3, :, :].astype(np.float32)
    # Accept both mobile names and legacy names
    if style in ("dramatic", "dramatic_clouds"):
        top = top * np.array([0.88, 0.88, 1.25])
    elif style == "sunset":
        top = top * np.array([1.35, 0.88, 0.65])
    elif style in ("stormy", "storm"):
        top = top * 0.65 + np.array([8.0, 8.0, 22.0])
    elif style == "vibrant":
        top = top * np.array([0.95, 1.05, 1.45])
    elif style == "blue_sky":
        top = top * np.array([0.82, 0.92, 1.45])
        top = np.clip(top + np.array([0, 5, 18]), 0, 255)
    elif style == "golden_hour":
        top = top * np.array([1.45, 1.10, 0.55])
        top = np.clip(top + np.array([20, 8, 0]), 0, 255)
    elif style == "twilight":
        top = top * np.array([0.75, 0.72, 1.35])
        top = np.clip(top + np.array([15, 5, 40]), 0, 255)
    elif style == "starry_night":
        top = top * np.array([0.55, 0.58, 1.20])
        top = np.clip(top + np.array([5, 5, 35]), 0, 255)
    arr = arr.astype(np.float32)
    arr[:h // 3, :, :] = np.clip(top, 0, 255)
    return arr


def _apply_vignette_np(arr: np.ndarray, intensity: float) -> np.ndarray:
    h, w = arr.shape[:2]
    cx, cy = w / 2, h / 2
    y_idx, x_idx = np.ogrid[:h, :w]
    dist = np.sqrt((x_idx - cx) ** 2 + (y_idx - cy) ** 2)
    max_d = np.sqrt(cx ** 2 + cy ** 2)
    factor = np.clip(1.0 - intensity * (dist / max_d), 0.0, 1.0)
    return arr * np.stack([factor] * 3, axis=-1)


def _apply_all_edits(img: Image.Image, ops: EditOperations) -> Image.Image:
    # ── 0. Rotation ────────────────────────────────────────────────────────────
    if ops.rotation and ops.rotation != 0:
        rot = ops.rotation % 360
        if rot == 90:
            img = img.transpose(Image.Transpose.ROTATE_90)
        elif rot == 180:
            img = img.transpose(Image.Transpose.ROTATE_180)
        elif rot == 270:
            img = img.transpose(Image.Transpose.ROTATE_270)

    # ── 0b. Straighten ────────────────────────────────────────────────────────
    if ops.straighten != 0:
        img = img.rotate(-ops.straighten, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(0, 0, 0))

    # ── 0c. Perspective correction ────────────────────────────────────────────
    if ops.perspective_v != 0 or ops.perspective_h != 0:
        import cv2
        arr_p = np.array(img)
        hp, wp = arr_p.shape[:2]
        src = np.float32([[0, 0], [wp, 0], [wp, hp], [0, hp]])
        pv = ops.perspective_v * 0.15 * wp
        ph = ops.perspective_h * 0.15 * hp
        dst = np.float32([
            [pv if ops.perspective_v > 0 else 0, ph if ops.perspective_h > 0 else 0],
            [wp - (pv if ops.perspective_v < 0 else 0), ph if ops.perspective_h < 0 else 0],
            [wp - (pv if ops.perspective_v > 0 else 0), hp - (ph if ops.perspective_h < 0 else 0)],
            [pv if ops.perspective_v < 0 else 0, hp - (ph if ops.perspective_h > 0 else 0)],
        ])
        M = cv2.getPerspectiveTransform(src, dst)
        result_p = cv2.warpPerspective(arr_p, M, (wp, hp), borderMode=cv2.BORDER_REPLICATE)
        img = Image.fromarray(result_p)

    # ── 0d. Flip ──────────────────────────────────────────────────────────────
    if ops.flip_horizontal:
        img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if ops.flip_vertical:
        img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)

    # ── 1. Crop ────────────────────────────────────────────────────────────────
    if ops.crop:
        c = ops.crop
        iw, ih = img.size
        left   = max(0, int(c.left * iw))
        top    = max(0, int(c.top  * ih))
        right  = min(iw, int((c.left + c.width)  * iw))
        bottom = min(ih, int((c.top  + c.height) * ih))
        if right > left + 4 and bottom > top + 4:
            img = img.crop((left, top, right, bottom))

    # ── 2. Actions ─────────────────────────────────────────────────────────────
    if ops.unblur > 0:
        img = _action_unblur(img, ops.unblur)
    if ops.portrait_blur > 0:
        img = _action_portrait_blur(img, ops.portrait_blur)
    if ops.pop > 0:
        img = _action_pop(img, ops.pop)
    if ops.magic_eraser:
        img = _action_magic_eraser(img, ops.magic_eraser)

    # ── 3. Filter ──────────────────────────────────────────────────────────────
    if ops.filter and ops.filter != "none":
        img = _apply_filter(img, ops.filter, ops.filter_intensity)

    # ── 4. Lighting (numpy) ────────────────────────────────────────────────────
    arr = np.array(img.convert("RGB"), dtype=np.float32)

    if ops.hdr:
        arr = _apply_hdr_np(arr)

    if ops.portrait_light:
        arr = _apply_portrait_light_np(arr)

    if ops.brightness != 0.0:
        # Additive lift + multiplicative: responsive at both ends of the range
        arr = arr * (1.0 + ops.brightness * 0.7) + ops.brightness * 55.0

    if ops.contrast != 0.0:
        # Stronger: pivot at 128, expand/contract more aggressively
        factor = 1.0 + ops.contrast * 1.5
        arr = (arr - 128.0) * factor + 128.0

    # Tone: midtone push — stronger bell curve
    if ops.tone != 0.0:
        arr = np.clip(arr, 0, 255)
        t = arr / 255.0
        arr = (t + ops.tone * t * (1.0 - t) * 4.0) * 255.0

    # Levels: white / black point
    if abs(ops.white_point - 1.0) > 0.005:
        white = max(0.05, ops.white_point) * 255.0
        arr = arr * (255.0 / white)
    if ops.black_point > 0.005:
        black = ops.black_point * 255.0
        denom = max(1.0, 255.0 - black)
        arr = (arr - black) * (255.0 / denom)

    # Highlights: target bright pixels with stronger weight
    if ops.highlights != 0.0:
        weight = np.clip((arr / 255.0 - 0.4) * 2.5, 0.0, 1.0) ** 1.5
        arr = arr + ops.highlights * weight * 200.0

    # Shadows: target dark pixels with stronger weight
    if ops.shadows != 0.0:
        weight = np.clip((0.6 - arr / 255.0) * 2.5, 0.0, 1.0) ** 1.5
        arr = arr + ops.shadows * weight * 200.0

    arr = np.clip(arr, 0, 255)

    # ── 5. Colors ──────────────────────────────────────────────────────────────
    if ops.saturation != 0.0:
        img_tmp = Image.fromarray(arr.astype(np.uint8))
        # Stronger range: -1 = full grayscale, +1 = 2.8× saturation
        factor = max(0.0, 1.0 + ops.saturation * 1.8)
        img_tmp = ImageEnhance.Color(img_tmp).enhance(factor)
        arr = np.array(img_tmp, dtype=np.float32)

    # Warmth: strong amber-blue axis shift
    if ops.warmth != 0.0:
        w = ops.warmth * 65.0
        arr[:, :, 0] = np.clip(arr[:, :, 0] + w,         0, 255)  # R ↑
        arr[:, :, 1] = np.clip(arr[:, :, 1] + w * 0.30,  0, 255)  # G slight
        arr[:, :, 2] = np.clip(arr[:, :, 2] - w,         0, 255)  # B ↓

    # Tint: strong magenta-green axis shift
    if ops.tint != 0.0:
        t = ops.tint * 50.0
        arr[:, :, 0] = np.clip(arr[:, :, 0] - t * 0.2, 0, 255)
        arr[:, :, 1] = np.clip(arr[:, :, 1] + t,        0, 255)
        arr[:, :, 2] = np.clip(arr[:, :, 2] - t * 0.2, 0, 255)

    # Skin Tone: orange/skin-range selective shift — wider mask, stronger push
    if ops.skin_tone != 0.0:
        r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
        skin = (
            (r > 80) & (r < 250) & (g > 40) & (g < 210) &
            (b > 20) & (b < 190) & (r > g)  & (r > b) &
            ((r.astype(np.int32) - b.astype(np.int32)) > 10)
        )
        st = ops.skin_tone * 45.0
        arr[:, :, 0] = np.where(skin, np.clip(r + st,        0, 255), r)
        arr[:, :, 1] = np.where(skin, np.clip(g + st * 0.55, 0, 255), g)
        arr[:, :, 2] = np.where(skin, np.clip(b - st * 0.15, 0, 255), b)

    # Blue Tone: broader cool-pixel mask, stronger shift
    if ops.blue_tone != 0.0:
        r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
        blue_px = (b.astype(np.int32) - (r.astype(np.int32) + g.astype(np.int32)) // 2) > 5
        bt = ops.blue_tone * 55.0
        arr[:, :, 2] = np.where(blue_px, np.clip(b + bt, 0, 255), b)
        if ops.blue_tone > 0:
            arr[:, :, 0] = np.where(blue_px, np.clip(r - bt * 0.2, 0, 255), r)

    arr = np.clip(arr, 0, 255)

    # Sky Style (applied before vignette so vignette sits on top)
    if ops.sky_style and ops.sky_style != "none":
        sky_full = _apply_sky_style_np(arr.copy(), ops.sky_style)
        t = max(0.0, min(1.0, ops.sky_intensity))
        arr = arr * (1.0 - t) + sky_full * t
        arr = np.clip(arr, 0, 255)

    # ── 6. Vignette ────────────────────────────────────────────────────────────
    if ops.vignette > 0.0:
        arr = _apply_vignette_np(arr, ops.vignette)
        arr = np.clip(arr, 0, 255)

    return Image.fromarray(arr.astype(np.uint8))


# ── Edit endpoint ─────────────────────────────────────────────────────────────

@app.post("/edit/image", tags=["edit"])
async def edit_image(request: EditImageRequest) -> Response:
    """
    Apply the requested edit operations to an image and return the result
    as JPEG bytes. All parameters are optional; omit or set to their default
    values to leave that adjustment untouched.

    Operation order: crop → actions → filter → lighting → colors → vignette.
    """
    img = _edit_load_image(request.image_path)

    loop = asyncio.get_running_loop()
    edited = await loop.run_in_executor(None, _apply_all_edits, img, request.operations)

    buf = io.BytesIO()
    quality = max(70, min(95, request.quality))
    edited.save(buf, format="JPEG", quality=quality, optimize=True)
    buf.seek(0)

    return Response(content=buf.read(), media_type="image/jpeg")


# ── Red-eye Removal ───────────────────────────────────────────────────────────

class RedEyeRequest(BaseModel):
    image_path: str


@app.post("/edit/red-eye", tags=["edit"])
async def remove_red_eye(request: RedEyeRequest) -> Response:
    """Detect and remove red-eye from faces in the image."""
    img = _edit_load_image(request.image_path)
    arr = np.array(img)

    if face_app is not None:
        faces = face_app.get(arr)
        for face in faces:
            bbox = face.bbox.astype(int)
            x1, y1, x2, y2 = bbox
            eye_h = int((y2 - y1) * 0.4)
            ey1 = max(0, y1)
            ey2 = min(arr.shape[0], y1 + eye_h)
            ex1 = max(0, x1)
            ex2 = min(arr.shape[1], x2)
            eye_region = arr[ey1:ey2, ex1:ex2]
            if eye_region.size == 0:
                continue
            r, g, b = eye_region[:, :, 0], eye_region[:, :, 1], eye_region[:, :, 2]
            red_mask = (
                (r > 80) & (r > (g.astype(np.int32) * 1.5).astype(np.uint8)) &
                (r > (b.astype(np.int32) * 1.5).astype(np.uint8)) &
                (g < 100) & (b < 100)
            )
            replacement = ((g.astype(np.int32) + b.astype(np.int32)) // 2).astype(np.uint8)
            eye_region[:, :, 0] = np.where(red_mask, replacement, r)
            arr[ey1:ey2, ex1:ex2] = eye_region

    result = Image.fromarray(arr)
    buf = io.BytesIO()
    result.save(buf, format="JPEG", quality=90)
    buf.seek(0)
    return Response(content=buf.read(), media_type="image/jpeg")


# ── Markup / Annotation ───────────────────────────────────────────────────────

class MarkupElement(BaseModel):
    type: str          # "line", "arrow", "rect", "circle", "text"
    color: str = "#FF0000"
    width: int = 3
    x1: float = 0
    y1: float = 0
    x2: float = 0
    y2: float = 0
    text: Optional[str] = None
    fontSize: int = 24


class MarkupRequest(BaseModel):
    image_path: str
    elements: list[MarkupElement]
    quality: int = 90


@app.post("/edit/markup", tags=["edit"])
async def apply_markup(request: MarkupRequest) -> Response:
    """Apply markup annotations (lines, arrows, text, shapes) to an image."""
    from PIL import ImageDraw, ImageFont
    import math

    img = _edit_load_image(request.image_path)
    draw = ImageDraw.Draw(img)
    w, h = img.size

    for elem in request.elements:
        color = elem.color
        lw = elem.width
        x1, y1 = int(elem.x1 * w), int(elem.y1 * h)
        x2, y2 = int(elem.x2 * w), int(elem.y2 * h)

        if elem.type == "line":
            draw.line([(x1, y1), (x2, y2)], fill=color, width=lw)
        elif elem.type == "arrow":
            draw.line([(x1, y1), (x2, y2)], fill=color, width=lw)
            angle = math.atan2(y2 - y1, x2 - x1)
            arrow_len = 15
            for da in [math.pi * 0.8, -math.pi * 0.8]:
                ax = x2 + int(arrow_len * math.cos(angle + da))
                ay = y2 + int(arrow_len * math.sin(angle + da))
                draw.line([(x2, y2), (ax, ay)], fill=color, width=lw)
        elif elem.type == "rect":
            draw.rectangle([(x1, y1), (x2, y2)], outline=color, width=lw)
        elif elem.type == "circle":
            draw.ellipse([(x1, y1), (x2, y2)], outline=color, width=lw)
        elif elem.type == "text" and elem.text:
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", elem.fontSize)
            except Exception:
                font = ImageFont.load_default()
            draw.text((x1, y1), elem.text, fill=color, font=font)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=request.quality)
    buf.seek(0)
    return Response(content=buf.read(), media_type="image/jpeg")


# ── Depth-Based Portrait Blur ─────────────────────────────────────────────────

class DepthBlurRequest(BaseModel):
    image_path: str
    blur_intensity: float = 1.0
    focus_point_x: float = 0.5
    focus_point_y: float = 0.5


@app.post("/edit/depth-blur", tags=["edit"])
async def depth_blur(request: DepthBlurRequest) -> Response:
    """Apply depth-based bokeh blur using distance from focus point + face awareness."""
    import cv2

    img = _edit_load_image(request.image_path)
    arr = np.array(img)
    h, w = arr.shape[:2]

    Y, X = np.ogrid[:h, :w]
    cx = int(request.focus_point_x * w)
    cy = int(request.focus_point_y * h)
    dist = np.sqrt(((X - cx) / w) ** 2 + ((Y - cy) / h) ** 2).astype(np.float32)
    depth_map = np.clip(dist / (dist.max() + 1e-6), 0, 1)

    if face_app is not None:
        faces = face_app.get(arr)
        for face in faces:
            bbox = face.bbox.astype(int)
            x1, y1, x2, y2 = bbox
            face_mask = np.zeros((h, w), dtype=np.float32)
            pad = 30
            face_mask[max(0, y1 - pad):min(h, y2 + pad), max(0, x1 - pad):min(w, x2 + pad)] = 1.0
            face_mask = cv2.GaussianBlur(face_mask, (61, 61), 0)
            depth_map = depth_map * (1.0 - face_mask)

    max_blur = int(10 + request.blur_intensity * 30)
    kernel = max_blur * 2 + 1
    blurred = cv2.GaussianBlur(arr, (kernel, kernel), 0)

    depth_3d = np.stack([depth_map] * 3, axis=-1)
    result = (arr.astype(np.float32) * (1 - depth_3d) + blurred.astype(np.float32) * depth_3d)
    result = np.clip(result, 0, 255).astype(np.uint8)

    buf = io.BytesIO()
    Image.fromarray(result).save(buf, format="JPEG", quality=90)
    buf.seek(0)
    return Response(content=buf.read(), media_type="image/jpeg")


# ── Phase 5: Delight Layer ────────────────────────────────────────────────────

# ── Pet Recognition ───────────────────────────────────────────────────────────

PET_BREEDS = {
    "dog": [
        "golden retriever", "labrador", "german shepherd", "bulldog", "poodle",
        "beagle", "husky", "corgi", "dachshund", "border collie", "pit bull",
        "rottweiler", "shih tzu", "chihuahua", "doberman", "great dane",
        "boxer", "dalmatian", "pomeranian", "yorkshire terrier",
    ],
    "cat": [
        "tabby cat", "siamese cat", "persian cat", "maine coon", "bengal cat",
        "ragdoll cat", "british shorthair", "abyssinian cat", "sphynx cat",
        "scottish fold", "russian blue cat", "norwegian forest cat", "birman cat",
        "orange tabby cat", "tuxedo cat", "calico cat",
    ],
}


class PetDetectRequest(BaseModel):
    image_path: str


class PetResult(BaseModel):
    bbox: BoundingBox
    species: str
    breed: str
    confidence: float
    embedding: list[float]


class PetDetectResponse(BaseModel):
    pets: list[PetResult]


@app.post("/detect/pets", response_model=PetDetectResponse, tags=["pets"])
async def detect_pets(request: PetDetectRequest) -> PetDetectResponse:
    """Detect pets (dogs/cats/birds) in an image using CLIP classification."""
    import torch

    if clip_model is None:
        return PetDetectResponse(pets=[])

    image = _load_image(request.image_path)

    def _detect():
        species_labels = [
            "a photo of a dog",
            "a photo of a cat",
            "a photo of a bird",
            "a photo of no animal",
            "a photo of a person",
        ]
        inputs = clip_processor(
            text=species_labels, images=image, return_tensors="pt",
            padding=True, truncation=True,
        )
        with torch.no_grad():
            outputs = clip_model(**inputs)
            probs = outputs.logits_per_image[0].softmax(dim=0).tolist()

        results = []
        for i, (label, prob) in enumerate(zip(species_labels, probs)):
            if i >= 3:
                break
            if prob < 0.25:
                continue

            species = label.replace("a photo of a ", "")

            breed = "unknown"
            if species in PET_BREEDS:
                breed_labels = [f"a photo of a {b}" for b in PET_BREEDS[species]]
                breed_inputs = clip_processor(
                    text=breed_labels, images=image, return_tensors="pt",
                    padding=True, truncation=True,
                )
                with torch.no_grad():
                    breed_out = clip_model(**breed_inputs)
                    breed_probs = breed_out.logits_per_image[0].softmax(dim=0).tolist()
                best_idx = breed_probs.index(max(breed_probs))
                breed = PET_BREEDS[species][best_idx]

            img_inputs = clip_processor(images=image, return_tensors="pt")
            with torch.no_grad():
                feats = clip_model.get_image_features(**img_inputs)
                feats = feats / feats.norm(dim=-1, keepdim=True)
                embedding = feats[0].tolist()

            w_img, h_img = image.size
            results.append(PetResult(
                bbox=BoundingBox(x1=0, y1=0, x2=w_img, y2=h_img),
                species=species,
                breed=breed,
                confidence=prob,
                embedding=embedding,
            ))

        return results

    loop = asyncio.get_running_loop()
    pets = await loop.run_in_executor(None, _detect)
    return PetDetectResponse(pets=pets)


# ── Subject Lift / Background Removal ─────────────────────────────────────────

class SubjectLiftRequest(BaseModel):
    image_path: str
    format: str = "png"


@app.post("/edit/subject-lift", tags=["edit"])
async def subject_lift(request: SubjectLiftRequest) -> Response:
    """Remove background, keeping only the subject. Returns PNG with transparency."""
    from rembg import remove

    img = _edit_load_image(request.image_path)
    loop = asyncio.get_running_loop()

    def _remove_bg():
        result = remove(img)
        if request.format == "white":
            white = Image.new("RGBA", result.size, (255, 255, 255, 255))
            white.paste(result, mask=result.split()[3])
            return white.convert("RGB")
        return result

    result = await loop.run_in_executor(None, _remove_bg)

    buf = io.BytesIO()
    if request.format == "png":
        result.save(buf, format="PNG")
        media_type = "image/png"
    else:
        result.save(buf, format="JPEG", quality=90)
        media_type = "image/jpeg"
    buf.seek(0)
    return Response(content=buf.read(), media_type=media_type)


# ── Auto Alt-Text / Image Captioning ─────────────────────────────────────────

class CaptionRequest(BaseModel):
    image_path: str


class CaptionResponse(BaseModel):
    caption: str
    confidence: float


@app.post("/caption", response_model=CaptionResponse, tags=["accessibility"])
async def generate_caption(request: CaptionRequest) -> CaptionResponse:
    """Generate a descriptive caption for the image (accessibility alt-text)."""
    import torch

    if clip_model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    image = _load_image(request.image_path)

    def _caption():
        subjects = [
            "people", "a person", "a group of people", "a family",
            "a dog", "a cat", "an animal",
            "food", "a meal", "a drink",
            "a landscape", "a beach", "mountains", "a city",
            "a building", "a street", "a park",
            "a sunset", "a sunrise", "the sky",
            "flowers", "trees", "nature",
            "a car", "a vehicle",
            "text or a document", "a screenshot",
            "an indoor scene", "a room",
        ]
        scene_candidates = [f"a photo of {s}" for s in subjects]
        inputs = clip_processor(
            text=scene_candidates, images=image, return_tensors="pt",
            padding=True, truncation=True,
        )
        with torch.no_grad():
            outputs = clip_model(**inputs)
            probs = outputs.logits_per_image[0].softmax(dim=0).tolist()

        ranked = sorted(zip(scene_candidates, probs), key=lambda x: x[1], reverse=True)
        top = ranked[:3]

        main_subject = top[0][0].replace("a photo of ", "")
        caption = f"Photo of {main_subject}"
        if top[1][1] > 0.1:
            secondary = top[1][0].replace("a photo of ", "")
            caption += f" with {secondary}"

        return caption, top[0][1]

    loop = asyncio.get_running_loop()
    caption, confidence = await loop.run_in_executor(None, _caption)
    return CaptionResponse(caption=caption, confidence=round(confidence, 4))


# ── Visual Look Up (Lite) ────────────────────────────────────────────────────

class VisualLookUpRequest(BaseModel):
    image_path: str


class LookUpResult(BaseModel):
    category: str
    label: str
    confidence: float


class VisualLookUpResponse(BaseModel):
    results: list[LookUpResult]


LOOKUP_CATEGORIES = {
    "landmark": [
        "Eiffel Tower", "Statue of Liberty", "Great Wall of China", "Taj Mahal",
        "Big Ben", "Colosseum", "Sydney Opera House", "Golden Gate Bridge",
        "Machu Picchu", "Pyramids of Giza", "Christ the Redeemer",
        "Leaning Tower of Pisa", "Stonehenge", "Burj Khalifa", "Mount Rushmore",
    ],
    "plant": [
        "rose", "sunflower", "tulip", "daisy", "orchid", "lily", "lavender",
        "cactus", "fern", "bamboo", "oak tree", "palm tree", "cherry blossom",
        "succulent", "monstera",
    ],
    "food": [
        "pizza", "sushi", "burger", "pasta", "salad", "cake", "ice cream",
        "bread", "steak", "tacos", "ramen", "curry", "pancakes", "croissant",
        "dim sum",
    ],
    "animal": [
        "golden retriever", "tabby cat", "parrot", "rabbit", "turtle",
        "butterfly", "eagle", "dolphin", "elephant", "giraffe", "penguin",
        "koala", "panda", "fox", "owl",
    ],
}


@app.post("/lookup", response_model=VisualLookUpResponse, tags=["intelligence"])
async def visual_lookup(request: VisualLookUpRequest) -> VisualLookUpResponse:
    """Identify objects in the image (landmarks, plants, food, animals)."""
    import torch

    if clip_model is None:
        raise HTTPException(status_code=503, detail="CLIP not loaded")

    image = _load_image(request.image_path)

    def _lookup():
        results = []
        for category, items in LOOKUP_CATEGORIES.items():
            labels = [f"a photo of {item}" for item in items]
            inputs = clip_processor(
                text=labels, images=image, return_tensors="pt",
                padding=True, truncation=True,
            )
            with torch.no_grad():
                outputs = clip_model(**inputs)
                probs = outputs.logits_per_image[0].softmax(dim=0).tolist()

            best_idx = probs.index(max(probs))
            best_conf = probs[best_idx]

            if best_conf > 0.15:
                results.append(LookUpResult(
                    category=category,
                    label=items[best_idx],
                    confidence=round(best_conf, 4),
                ))

        results.sort(key=lambda r: r.confidence, reverse=True)
        return results[:5]

    loop = asyncio.get_running_loop()
    results = await loop.run_in_executor(None, _lookup)
    return VisualLookUpResponse(results=results)


# ── Video Moment Search ───────────────────────────────────────────────────────

class VideoSearchRequest(BaseModel):
    video_path: str
    query: str
    sample_interval: float = 2.0


class VideoMoment(BaseModel):
    timestamp: float
    similarity: float


class VideoSearchResponse(BaseModel):
    moments: list[VideoMoment]


@app.post("/search/video", response_model=VideoSearchResponse, tags=["search"])
async def search_video(request: VideoSearchRequest) -> VideoSearchResponse:
    """Search inside a video for moments matching a text query."""
    import subprocess
    import tempfile
    import torch

    if clip_model is None:
        raise HTTPException(status_code=503, detail="CLIP not loaded")

    resolved = _resolve_image_path(request.video_path)
    if not os.path.exists(resolved):
        raise HTTPException(status_code=404, detail="Video not found")

    def _search():
        with tempfile.TemporaryDirectory() as tmpdir:
            subprocess.run(
                [
                    "ffmpeg", "-i", resolved,
                    "-vf", f"fps=1/{request.sample_interval}",
                    "-q:v", "5",
                    os.path.join(tmpdir, "frame_%04d.jpg"),
                ],
                capture_output=True, timeout=60,
            )

            frames = sorted([f for f in os.listdir(tmpdir) if f.startswith("frame_")])
            if not frames:
                return []

            text_inputs = clip_processor(
                text=[request.query], return_tensors="pt",
                padding=True, truncation=True,
            )
            with torch.no_grad():
                text_feats = clip_model.get_text_features(**text_inputs)
                text_feats = text_feats / text_feats.norm(dim=-1, keepdim=True)

            moments = []
            for i, frame_file in enumerate(frames):
                frame_path = os.path.join(tmpdir, frame_file)
                img = Image.open(frame_path).convert("RGB")
                img_inputs = clip_processor(images=img, return_tensors="pt")
                with torch.no_grad():
                    img_feats = clip_model.get_image_features(**img_inputs)
                    img_feats = img_feats / img_feats.norm(dim=-1, keepdim=True)

                similarity = (text_feats @ img_feats.T).item()
                timestamp = i * request.sample_interval
                moments.append(VideoMoment(
                    timestamp=timestamp, similarity=round(similarity, 4),
                ))

            moments.sort(key=lambda m: m.similarity, reverse=True)
            return [m for m in moments[:10] if m.similarity > 0.2]

    loop = asyncio.get_running_loop()
    moments = await loop.run_in_executor(None, _search)
    return VideoSearchResponse(moments=moments)


# ── Aesthetic Scoring ─────────────────────────────────────────────────────────

class AestheticScoreRequest(BaseModel):
    image_path: str


class AestheticScoreResponse(BaseModel):
    score: float
    quality: str


@app.post("/score/aesthetic", response_model=AestheticScoreResponse, tags=["intelligence"])
async def aesthetic_score(request: AestheticScoreRequest) -> AestheticScoreResponse:
    """Score image aesthetic quality (composition, exposure, sharpness)."""
    import torch

    if clip_model is None:
        raise HTTPException(status_code=503, detail="CLIP not loaded")

    image = _load_image(request.image_path)

    def _score():
        quality_labels = [
            "a beautiful, well-composed, professional photograph",
            "a good quality photograph with nice lighting",
            "an average quality photograph",
            "a poorly composed, blurry, or dark photograph",
            "a very low quality, unusable photograph",
        ]
        quality_scores = [9.5, 7.5, 5.5, 3.0, 1.0]

        inputs = clip_processor(
            text=quality_labels, images=image, return_tensors="pt",
            padding=True, truncation=True,
        )
        with torch.no_grad():
            outputs = clip_model(**inputs)
            probs = outputs.logits_per_image[0].softmax(dim=0).tolist()

        score = sum(p * s for p, s in zip(probs, quality_scores))
        score = max(1.0, min(10.0, score))

        if score >= 8.0:
            quality = "excellent"
        elif score >= 6.0:
            quality = "high"
        elif score >= 4.0:
            quality = "medium"
        else:
            quality = "low"

        return round(score, 2), quality

    loop = asyncio.get_running_loop()
    score, quality = await loop.run_in_executor(None, _score)
    return AestheticScoreResponse(score=score, quality=quality)
