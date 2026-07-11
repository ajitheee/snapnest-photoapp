<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { api } from '$lib/api';
  import type { Asset } from '$lib/api';
  import Hls from 'hls.js';
  import { settings } from '$lib/settings';

  /** The flat list of assets to navigate through. */
  export let assets: Asset[] = [];
  /** Index of the currently viewed asset. -1 = closed. Bind this in the parent. */
  export let viewerIndex: number = -1;
  /**
   * 'default' — shows Favorite / Archive / Trash / Edit actions.
   * 'trash'   — shows Restore / Delete Permanently instead.
   */
  export let mode: 'default' | 'trash' = 'default';

  const dispatch = createEventDispatcher<{
    assetUpdated: Asset;
    assetRemoved: string;
  }>();

  $: viewerAsset = viewerIndex >= 0 && viewerIndex < assets.length
    ? assets[viewerIndex]
    : null;

  // ── zoom / pan ────────────────────────────────────────────────────────────
  let zoomScale = 1;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let lastPinchDist = 0;

  function resetZoom() { zoomScale = 1; panX = 0; panY = 0; }

  function displayName(fileName: string): string {
    const idx = fileName.indexOf('_o_');
    return idx >= 0 ? fileName.slice(idx + 3) : fileName;
  }

  const ZOOM_STEP = 1.5;
  function zoomIn()  { zoomScale = Math.min(10, zoomScale * ZOOM_STEP); }
  function zoomOut() {
    zoomScale = Math.max(1, zoomScale / ZOOM_STEP);
    if (zoomScale === 1) { panX = 0; panY = 0; }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.85 : 1.18;
    zoomScale = Math.min(10, Math.max(1, zoomScale * delta));
    if (zoomScale === 1) { panX = 0; panY = 0; }
  }

  // ── mouse drag-down-to-close (desktop) ─────────────────────────────────
  let mouseDragActive = false;
  let mouseDragStartY = 0;
  let mouseDragStartX = 0;
  let mouseDragY = 0;
  let mouseDragLocked = false;
  let mouseDragCancelled = false;

  function onPanStart(e: MouseEvent) {
    if (zoomScale > 1) {
      isPanning = true;
      panStartX = e.clientX - panX;
      panStartY = e.clientY - panY;
      return;
    }
    if (!editOpen && !cropMode) {
      mouseDragActive = true;
      mouseDragStartY = e.clientY;
      mouseDragStartX = e.clientX;
      mouseDragY = 0;
      mouseDragLocked = false;
      mouseDragCancelled = false;
    }
  }
  function onPanMove(e: MouseEvent) {
    if (isPanning) {
      panX = e.clientX - panStartX;
      panY = e.clientY - panStartY;
      return;
    }
    if (!mouseDragActive || mouseDragCancelled) return;
    const dy = e.clientY - mouseDragStartY;
    const dx = Math.abs(e.clientX - mouseDragStartX);
    if (!mouseDragLocked) {
      if (dx > DIRECTION_LOCK_PX) { mouseDragCancelled = true; mouseDragY = 0; return; }
      if (dy > DIRECTION_LOCK_PX) { mouseDragLocked = true; } else { return; }
    }
    if (dy > 0) {
      e.preventDefault();
      mouseDragY = dy;
      swipeDragY = dy;
    }
  }
  function onPanEnd() {
    isPanning = false;
    if (mouseDragLocked && mouseDragY >= SWIPE_CLOSE_THRESHOLD) {
      close();
    }
    mouseDragY = 0;
    mouseDragActive = false;
    mouseDragLocked = false;
    mouseDragCancelled = false;
    swipeDragY = 0;
  }

  // ── swipe-down-to-close ────────────────────────────────────────────────
  let swipeDragY = 0;
  let swipeStartY = 0;
  let swipeStartX = 0;
  let swipeActive = false;
  let swipeLocked = false;  // true once we confirm vertical direction
  let swipeCancelled = false; // true if horizontal swipe detected
  const SWIPE_CLOSE_THRESHOLD = 100;
  const DIRECTION_LOCK_PX = 10; // pixels before locking direction

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      lastPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      swipeActive = false;
      swipeLocked = false;
      return;
    }
    if (e.touches.length === 1 && zoomScale <= 1 && !editOpen && !cropMode) {
      swipeStartY = e.touches[0].clientY;
      swipeStartX = e.touches[0].clientX;
      swipeDragY = 0;
      swipeActive = true;
      swipeLocked = false;
      swipeCancelled = false;
    }
  }
  function onTouchMove(e: TouchEvent) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      if (lastPinchDist > 0) {
        zoomScale = Math.min(10, Math.max(1, zoomScale * (dist / lastPinchDist)));
        if (zoomScale === 1) { panX = 0; panY = 0; }
      }
      lastPinchDist = dist;
      swipeActive = false;
      swipeLocked = false;
      return;
    }
    if (!swipeActive || swipeCancelled || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - swipeStartY;
    const dx = Math.abs(e.touches[0].clientX - swipeStartX);
    if (!swipeLocked) {
      if (dx > DIRECTION_LOCK_PX) {
        swipeCancelled = true;
        swipeDragY = 0;
        return;
      }
      if (dy > DIRECTION_LOCK_PX) {
        swipeLocked = true;
      } else {
        return;
      }
    }
    if (dy > 0) {
      e.preventDefault();
      swipeDragY = dy;
    }
  }
  function onTouchEnd() {
    if (swipeLocked && swipeDragY >= SWIPE_CLOSE_THRESHOLD) {
      close();
    }
    swipeDragY = 0;
    swipeActive = false;
    swipeLocked = false;
    swipeCancelled = false;
  }

  // ── keyboard ──────────────────────────────────────────────────────────────
  function onKey(e: KeyboardEvent) {
    if (!viewerAsset) return;
    if (e.key === 'Escape') {
      if (editOpen) { closeEdit(); return; }
      close();
    } else if (e.key === 'ArrowLeft'  && zoomScale === 1 && !editOpen) prev();
    else if   (e.key === 'ArrowRight' && zoomScale === 1 && !editOpen) next();
  }

  function close() { editOpen = false; clearPreview(); viewerIndex = -1; resetZoom(); videoError = false; livePhotoPlaying = false; }
  function prev()  { if (viewerIndex > 0)                 { editOpen = false; clearPreview(); viewerIndex--; resetZoom(); videoError = false; livePhotoPlaying = false; } }
  function next()  { if (viewerIndex < assets.length - 1) { editOpen = false; clearPreview(); viewerIndex++; resetZoom(); videoError = false; livePhotoPlaying = false; } }

  // ── viewer actions ────────────────────────────────────────────────────────
  let shareLink = '';
  let shareCopied = false;
  async function shareAsset() {
    if (!viewerAsset) return;
    try {
      const link = await api.sharing.create({ assetId: viewerAsset.id });
      shareLink = `${window.location.origin}/s/${link.token}`;
      await navigator.clipboard.writeText(shareLink);
      shareCopied = true;
      setTimeout(() => { shareCopied = false; shareLink = ''; }, 3000);
    } catch (e) {
      console.error('Share failed', e);
    }
  }

  async function toggleFavorite() {
    if (!viewerAsset) return;
    const updated = await api.assets.toggleFavorite(viewerAsset.id);
    assets = assets.map(a => a.id === updated.id ? updated : a);
    dispatch('assetUpdated', updated);
  }

  async function archiveAsset() {
    if (!viewerAsset) return;
    await api.assets.toggleArchive(viewerAsset.id);
    const id = viewerAsset.id;
    close();
    dispatch('assetRemoved', id);
  }

  async function trashAsset() {
    if (!viewerAsset) return;
    await api.assets.softDelete(viewerAsset.id);
    const id = viewerAsset.id;
    close();
    dispatch('assetRemoved', id);
  }

  async function restoreAsset() {
    if (!viewerAsset) return;
    await api.assets.restore(viewerAsset.id);
    const id = viewerAsset.id;
    close();
    dispatch('assetRemoved', id);
  }

  async function permanentDelete() {
    if (!viewerAsset) return;
    if (!confirm(`Permanently delete "${displayName(viewerAsset.fileName)}"? This cannot be undone.`)) return;
    await api.assets.permanentDelete(viewerAsset.id);
    const id = viewerAsset.id;
    close();
    dispatch('assetRemoved', id);
  }

  // ── HLS video player ──────────────────────────────────────────────────────
  let videoError = false;

  function hlsUrl(asset: Asset) {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
    const v = asset.updatedAt ? `_v=${new Date(asset.updatedAt).getTime()}` : '';
    const qs = [token ? `token=${encodeURIComponent(token)}` : '', v].filter(Boolean).join('&');
    return `/api/assets/${asset.id}/stream/master.m3u8${qs ? `?${qs}` : ''}`;
  }

  function posterUrl(asset: Asset) {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
    const v = asset.updatedAt ? `&_v=${new Date(asset.updatedAt).getTime()}` : '';
    return `/api/assets/${asset.id}/thumbnail${token ? `?token=${encodeURIComponent(token)}&size=large${v}` : `?size=large${v}`}`;
  }

  function hlsPlayer(node: HTMLVideoElement, src: string) {
    let hls: Hls | null = null;
    videoError = false;

    function init(s: string) {
      videoError = false;
      if (hls) { hls.destroy(); hls = null; }
      if (Hls.isSupported()) {
        hls = new Hls({
          startLevel: -1,
          abrEwmaDefaultEstimate: 500000,
          xhrSetup(xhr: XMLHttpRequest) {
            const token = typeof localStorage !== 'undefined'
              ? localStorage.getItem('photoapp_token')
              : null;
            if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          },
        });
        hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
          if (data.fatal) { videoError = true; hls?.destroy(); hls = null; }
        });
        hls.loadSource(s);
        hls.attachMedia(node);
      } else if (node.canPlayType('application/vnd.apple.mpegurl')) {
        node.src = s;
      }
    }

    init(src);
    return {
      update(s: string) { init(s); },
      destroy()         { if (hls) { hls.destroy(); hls = null; } },
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  function fullUrl(asset: Asset) {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    const v = asset.updatedAt ? `${qs ? '&' : '?'}_v=${new Date(asset.updatedAt).getTime()}` : '';
    // Show saved edit if one exists
    if (asset.editedPath) {
      return `/api/assets/${asset.id}/edited${qs}${v}`;
    }
    const isHeic = asset.mimeType === 'image/heic' || asset.mimeType === 'image/heif'
      || asset.fileName?.toLowerCase().endsWith('.heic')
      || asset.fileName?.toLowerCase().endsWith('.heif');
    if ($settings.assetViewer.loadOriginalImage && !isHeic) {
      return token ? `/api/assets/${asset.id}/download?token=${encodeURIComponent(token)}${v}` : `/api/assets/${asset.id}/download${v}`;
    }
    return `/api/assets/${asset.id}/thumbnail${token ? `?token=${encodeURIComponent(token)}&size=large${v}` : `?size=large${v}`}`;
  }
  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  function formatSize(b: string) {
    const n = parseInt(b, 10);
    return n < 1_048_576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1_048_576).toFixed(1)} MB`;
  }

  // ── live photo ────────────────────────────────────────────────────────────
  let livePhotoPlaying = false;
  let liveVideoEl: HTMLVideoElement | null = null;

  function startLive() {
    if (!viewerAsset?.isLivePhoto) return;
    livePhotoPlaying = true;
    if (liveVideoEl) {
      if (liveVideoEl.readyState === 0) liveVideoEl.load();
      liveVideoEl.currentTime = 0;
      liveVideoEl.play().catch(() => { livePhotoPlaying = false; });
    }
  }
  function stopLive() {
    livePhotoPlaying = false;
    if (liveVideoEl) { liveVideoEl.pause(); liveVideoEl.currentTime = 0; }
  }

  // ── edit panel ────────────────────────────────────────────────────────────
  let editOpen = false;
  let editTab: 'actions' | 'filters' | 'lighting' | 'colors' = 'actions';
  let editPreviewing = false;
  let editSaving = false;
  let editReverting = false;
  let editSavedMsg = false;
  let editPreviewUrl: string | null = null;
  let editError = '';
  let liveTimer: ReturnType<typeof setTimeout> | null = null;

  // ── video edit state ──────────────────────────────────────────────────────
  interface VideoEditState {
    autoEnhance: boolean;
    trimStartSec: number;
    trimEndSec: number;
    speed: number;
    muted: boolean;
    filter: string;
    brightness: number;  // -100..100
    contrast:   number;
    saturation: number;
  }
  let videoEl: HTMLVideoElement | null = null;
  let videoDuration = 0;

  function defaultVideoState(): VideoEditState {
    return {
      autoEnhance: false,
      trimStartSec: 0,
      trimEndSec: 0,
      speed: 1.0,
      muted: false,
      filter: 'none',
      brightness: 0,
      contrast:   0,
      saturation: 0,
    };
  }

  function videoStateFromSaved(params: Record<string, unknown>): VideoEditState {
    const dur = videoDuration || 0;
    return {
      autoEnhance:  (params.autoEnhance  as boolean) ?? false,
      trimStartSec: params.trimStartMs != null ? (params.trimStartMs as number) / 1000 : 0,
      trimEndSec:   params.trimEndMs   != null ? (params.trimEndMs   as number) / 1000 : dur,
      speed:        (params.speed      as number)  ?? 1.0,
      muted:        (params.muted      as boolean) ?? false,
      filter:       (params.filter     as string)  ?? 'none',
      brightness:   Math.round(((params.brightness as number) ?? 0) * 100),
      contrast:     Math.round(((params.contrast   as number) ?? 0) * 100),
      saturation:   Math.round(((params.saturation as number) ?? 0) * 100),
    };
  }

  function buildVideoApiParams(): Record<string, unknown> {
    const dur = videoDuration || 0;
    const p: Record<string, unknown> = {};
    if (vep.autoEnhance) p.autoEnhance = true;
    if (vep.trimStartSec > 0)                       p.trimStartMs = Math.round(vep.trimStartSec * 1000);
    if (vep.trimEndSec > 0 && vep.trimEndSec < dur) p.trimEndMs   = Math.round(vep.trimEndSec   * 1000);
    if (vep.speed !== 1.0)  p.speed  = vep.speed;
    if (vep.muted)          p.muted  = true;
    if (vep.filter !== 'none') p.filter = vep.filter;
    if (!vep.autoEnhance) {
      if (vep.brightness !== 0) p.brightness = vep.brightness / 100;
      if (vep.contrast   !== 0) p.contrast   = vep.contrast   / 100;
      if (vep.saturation !== 0) p.saturation = vep.saturation / 100;
    }
    return p;
  }

  let vep: VideoEditState = defaultVideoState();

  // ── Crop state ────────────────────────────────────────────────────────────
  let cropMode = false;
  let cropDragging = false;
  let cropDragStart = { x: 0, y: 0 };
  let cropAspect = 'free';
  let cropContainerEl: HTMLDivElement | null = null;
  let cropNatW = 4, cropNatH = 3;

  function isDefaultState(s: EditState): boolean {
    const d = defaultEditState();
    return (s.crop === null &&
      s.unblur === d.unblur && s.portraitBlur === d.portraitBlur && s.pop === d.pop &&
      s.filter === d.filter && s.skyStyle === d.skyStyle &&
      s.hdr === d.hdr && s.portraitLight === d.portraitLight &&
      s.brightness === d.brightness && s.contrast === d.contrast && s.tone === d.tone &&
      s.whitePoint === d.whitePoint && s.blackPoint === d.blackPoint &&
      s.highlights === d.highlights && s.shadows === d.shadows && s.vignette === d.vignette &&
      s.saturation === d.saturation && s.warmth === d.warmth && s.tint === d.tint &&
      s.skinTone === d.skinTone && s.blueTone === d.blueTone);
  }

  function scheduleLivePreview() {
    if (!editOpen || !viewerAsset) return;
    if (isDefaultState(ep)) { clearPreview(); return; }
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { liveTimer = null; doPreview(); }, 800);
  }

  $: ep && editOpen && scheduleLivePreview();

  interface CropRect { left: number; top: number; width: number; height: number; }

  interface EditState {
    crop: CropRect | null;
    unblur: number; portraitBlur: number; pop: number;
    filter: string; filterIntensity: number;
    skyStyle: string; skyIntensity: number;
    hdr: boolean; portraitLight: boolean;
    brightness: number; contrast: number; tone: number;
    whitePoint: number; blackPoint: number;
    highlights: number; shadows: number; vignette: number;
    saturation: number; warmth: number; tint: number;
    skinTone: number; blueTone: number;
    rotation: number;
  }

  function defaultEditState(): EditState {
    return {
      crop: null,
      unblur: 0, portraitBlur: 0, pop: 0,
      filter: 'none', filterIntensity: 100,
      skyStyle: 'none', skyIntensity: 100,
      hdr: false, portraitLight: false,
      brightness: 0, contrast: 0, tone: 0,
      whitePoint: 100, blackPoint: 0, highlights: 0, shadows: 0, vignette: 0,
      saturation: 0, warmth: 0, tint: 0, skinTone: 0, blueTone: 0,
      rotation: 0,
    };
  }

  function editStateFromSaved(params: Record<string, unknown>): EditState {
    const n = (k: string, def = 0) => Math.round(((params[k] as number) ?? def) * 100);
    return {
      crop:         (params.crop as CropRect | null) ?? null,
      unblur:       n('unblur'),
      portraitBlur: n('portraitBlur'),
      pop:          n('pop'),
      filter:       (params.filter as string) ?? 'none',
      filterIntensity: n('filterIntensity', 1.0),
      skyStyle:     (params.skyStyle as string) ?? 'none',
      skyIntensity: n('skyIntensity', 1.0),
      hdr:          (params.hdr as boolean) ?? false,
      portraitLight:(params.portraitLight as boolean) ?? false,
      brightness:   n('brightness'),
      contrast:     n('contrast'),
      tone:         n('tone'),
      whitePoint:   n('whitePoint', 1.0),
      blackPoint:   n('blackPoint'),
      highlights:   n('highlights'),
      shadows:      n('shadows'),
      vignette:     n('vignette'),
      saturation:   n('saturation'),
      warmth:       n('warmth'),
      tint:         n('tint'),
      skinTone:     n('skinTone'),
      blueTone:     n('blueTone'),
      rotation:     (params.rotation as number) ?? 0,
    };
  }

  let ep: EditState = defaultEditState();

  // Unified filter list matching mobile app — all implemented in ML service
  const FILTERS = [
    'none','vivid','dramatic','noir','cinematic','fade',
    'warm','cool','chrome','film','matte','vintage','instant',
    'process','tonal','transfer','silvertone',
    'mono','playa','honey','clarendon','juno','lark',
    'aden','nashville',
  ] as const;
  const SKY_STYLES = [
    'none','blue_sky','sunset','dramatic_clouds','storm',
    'golden_hour','twilight','starry_night',
  ] as const;

  const ACTION_SLIDERS = [
    { label: 'Unblur',         key: 'unblur'       as keyof EditState, icon: '🔍' },
    { label: 'Pop',            key: 'pop'          as keyof EditState, icon: '✨' },
    { label: 'Portrait Blur',  key: 'portraitBlur' as keyof EditState, icon: '👤' },
  ];

  const LIGHTING_SLIDERS = [
    { label: 'Brightness',   key: 'brightness'  as keyof EditState, min: -100, max: 100 },
    { label: 'Contrast',     key: 'contrast'    as keyof EditState, min: -100, max: 100 },
    { label: 'Tone',         key: 'tone'        as keyof EditState, min: -100, max: 100 },
    { label: 'White Point',  key: 'whitePoint'  as keyof EditState, min:   50, max: 100 },
    { label: 'Black Point',  key: 'blackPoint'  as keyof EditState, min:    0, max:  50 },
    { label: 'Highlights',   key: 'highlights'  as keyof EditState, min: -100, max: 100 },
    { label: 'Shadows',      key: 'shadows'     as keyof EditState, min: -100, max: 100 },
    { label: 'Vignette',     key: 'vignette'    as keyof EditState, min:    0, max: 100 },
  ];

  const COLOR_SLIDERS = [
    { label: 'Saturation', key: 'saturation' as keyof EditState },
    { label: 'Warmth',     key: 'warmth'     as keyof EditState },
    { label: 'Tint',       key: 'tint'       as keyof EditState },
    { label: 'Skin Tone',  key: 'skinTone'   as keyof EditState },
    { label: 'Blue Tone',  key: 'blueTone'   as keyof EditState },
  ];

  function buildApiParams(): Record<string, unknown> {
    const p: Record<string, unknown> = {};
    if (ep.crop) p.crop = ep.crop;
    if (ep.unblur)        p.unblur        = ep.unblur       / 100;
    if (ep.portraitBlur)  p.portraitBlur  = ep.portraitBlur / 100;
    if (ep.pop)           p.pop           = ep.pop          / 100;
    if (ep.filter !== 'none') {
      p.filter = ep.filter;
      p.filterIntensity = ep.filterIntensity / 100;
    }
    if (ep.skyStyle !== 'none') {
      p.skyStyle = ep.skyStyle;
      p.skyIntensity = ep.skyIntensity / 100;
    }
    if (ep.hdr)           p.hdr           = true;
    if (ep.portraitLight) p.portraitLight = true;
    if (ep.brightness)    p.brightness    = ep.brightness / 100;
    if (ep.contrast)      p.contrast      = ep.contrast   / 100;
    if (ep.tone)          p.tone          = ep.tone       / 100;
    if (ep.whitePoint !== 100) p.whitePoint = ep.whitePoint / 100;
    if (ep.blackPoint)    p.blackPoint    = ep.blackPoint / 100;
    if (ep.highlights)    p.highlights    = ep.highlights / 100;
    if (ep.shadows)       p.shadows       = ep.shadows    / 100;
    if (ep.vignette)      p.vignette      = ep.vignette   / 100;
    if (ep.saturation)    p.saturation    = ep.saturation / 100;
    if (ep.warmth)        p.warmth        = ep.warmth     / 100;
    if (ep.tint)          p.tint          = ep.tint       / 100;
    if (ep.skinTone)      p.skinTone      = ep.skinTone   / 100;
    if (ep.blueTone)      p.blueTone      = ep.blueTone   / 100;
    if (ep.rotation)      p.rotation      = ep.rotation;
    return p;
  }

  function openEdit() {
    if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; }
    const saved = viewerAsset?.editParams;
    if (viewerAsset?.type === 'VIDEO') {
      vep = (saved && Object.keys(saved).length > 0)
        ? videoStateFromSaved(saved as Record<string, unknown>)
        : defaultVideoState();
    } else {
      ep = (saved && Object.keys(saved).length > 0)
        ? editStateFromSaved(saved as Record<string, unknown>)
        : defaultEditState();
    }
    cropMode = false; cropAspect = 'free';
    clearPreview();
    editError = '';
    editSavedMsg = false;
    editOpen = true;
    editTab = 'actions';
  }

  async function doVideoSave() {
    if (!viewerAsset) return;
    editSaving = true; editError = ''; editSavedMsg = false;
    try {
      const updated = await api.assets.editSave(viewerAsset.id, buildVideoApiParams());
      assets = assets.map(a => a.id === updated.id ? updated : a);
      dispatch('assetUpdated', updated);
      editSavedMsg = true;
    } catch (e: any) {
      editError = e?.message ?? 'Save failed';
    } finally {
      editSaving = false;
    }
  }

  function closeEdit() {
    if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; }
    editOpen = false;
    editSavedMsg = false;
    cropMode = false;
    clearPreview();
    editError = '';
  }

  // ── Crop handlers ─────────────────────────────────────────────────────────
  function openCropMode() { cropMode = true; cropAspect = 'free'; }

  function applyCrop() {
    // Discard tiny drags
    if (ep.crop && (ep.crop.width < 0.02 || ep.crop.height < 0.02)) {
      ep = { ...ep, crop: null };
    }
    cropMode = false;
  }

  function cancelCrop() {
    cropMode = false;
    ep = { ...ep, crop: null };
  }

  function mouseToFrac(e: MouseEvent | Touch): CropRect['left'] | null {
    if (!cropContainerEl) return null;
    const r = cropContainerEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
    return { x, y } as any;
  }

  function buildCropRect(ax: number, ay: number, bx: number, by: number): CropRect {
    let left  = Math.min(ax, bx);
    let top   = Math.min(ay, by);
    let width  = Math.abs(bx - ax);
    let height = Math.abs(by - ay);

    if (cropAspect !== 'free') {
      const [aw, ah] = cropAspect.split(':').map(Number);
      const imgAspect = cropNatW / cropNatH;
      const normRatio = (aw / ah) / imgAspect;
      height = width / normRatio;
      if (top + height > 1) { height = 1 - top; width = height * normRatio; }
      if (left + width > 1) { width  = 1 - left; height = width / normRatio; }
    }
    return { left, top, width, height };
  }

  function onCropMouseDown(e: MouseEvent) {
    e.preventDefault();
    if (!cropContainerEl) return;
    const r = cropContainerEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
    cropDragStart = { x, y };
    cropDragging = true;
    ep = { ...ep, crop: { left: x, top: y, width: 0, height: 0 } };
  }

  function onCropMouseMove(e: MouseEvent) {
    if (!cropDragging || !cropContainerEl) return;
    const r = cropContainerEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
    ep = { ...ep, crop: buildCropRect(cropDragStart.x, cropDragStart.y, x, y) };
  }

  function onCropMouseUp() {
    cropDragging = false;
    if (ep.crop && (ep.crop.width < 0.02 || ep.crop.height < 0.02)) {
      ep = { ...ep, crop: null };
    }
  }

  function onCropTouchStart(e: TouchEvent) {
    e.preventDefault();
    if (!cropContainerEl || !e.touches[0]) return;
    const t = e.touches[0];
    const r = cropContainerEl.getBoundingClientRect();
    cropDragStart = {
      x: Math.max(0, Math.min(1, (t.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (t.clientY - r.top)  / r.height)),
    };
    cropDragging = true;
  }

  function onCropTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (!cropDragging || !cropContainerEl || !e.touches[0]) return;
    const t = e.touches[0];
    const r = cropContainerEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (t.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (t.clientY - r.top)  / r.height));
    ep = { ...ep, crop: buildCropRect(cropDragStart.x, cropDragStart.y, x, y) };
  }

  function onCropTouchEnd() { onCropMouseUp(); }

  function onCropImgLoad(e: Event) {
    const img = e.target as HTMLImageElement;
    cropNatW = img.naturalWidth  || 4;
    cropNatH = img.naturalHeight || 3;
  }

  function clearPreview() {
    if (editPreviewUrl) { URL.revokeObjectURL(editPreviewUrl); editPreviewUrl = null; }
  }

  async function doPreview() {
    if (!viewerAsset) return;
    editPreviewing = true;
    editError = '';
    try {
      clearPreview();
      editPreviewUrl = await api.assets.editPreview(viewerAsset.id, buildApiParams());
    } catch (e: any) {
      editError = e.message ?? 'Preview failed';
    } finally {
      editPreviewing = false;
    }
  }

  async function doSave() {
    if (!viewerAsset) return;
    editSaving = true;
    editError = '';
    try {
      const updated = await api.assets.editSave(viewerAsset.id, buildApiParams());
      assets = assets.map(a => a.id === updated.id ? updated : a);
      dispatch('assetUpdated', updated);
      // Keep panel open briefly so user sees the edited image and "Saved" confirmation.
      // The main viewer now shows /edited URL (fullUrl uses editedPath).
      // editPreviewUrl stays so the viewer keeps showing the ML result without re-fetch.
      editSavedMsg = true;
    } catch (e: any) {
      editError = e.message ?? 'Save failed';
    } finally {
      editSaving = false;
    }
  }

  async function doRevert() {
    if (!viewerAsset) return;
    if (!confirm('Remove saved edit and revert to original?')) return;
    editError = '';
    editReverting = true;
    try {
      const updated = await api.assets.revertEdit(viewerAsset.id);
      assets = assets.map(a => a.id === updated.id ? updated : a);
      dispatch('assetUpdated', updated);
      closeEdit();
    } catch (e: any) {
      editError = e.message ?? 'Revert failed';
    } finally {
      editReverting = false;
    }
  }

  // ── Info / Map panel ───────────────────────────────────────────────────────
  let infoOpen = false;
  function toggleInfo() { infoOpen = !infoOpen; }

  function mapEmbedUrl(lat: number, lng: number): string {
    const d = 0.008;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&layer=mapnik&marker=${lat},${lng}`;
  }
  function mapLinkUrl(lat: number, lng: number): string {
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`;
  }

  function capLabel(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function setEditTab(tab: string) { editTab = tab as typeof editTab; }
</script>

<svelte:window on:keydown={onKey} />

{#if viewerAsset}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="viewer-backdrop"
    class:swipe-dragging={swipeDragY > 0}
    role="dialog"
    aria-modal="true"
    on:click|self={close}
    on:wheel|nonpassive={onWheel}
    on:mousemove={onPanMove}
    on:mouseup={onPanEnd}
    on:mouseleave={onPanEnd}
    on:touchstart|nonpassive={onTouchStart}
    on:touchmove|nonpassive={onTouchMove}
    on:touchend|nonpassive={onTouchEnd}
    style={swipeDragY > 0 ? `background: rgba(0,0,0,${Math.max(0.2, 0.92 - swipeDragY / 400)})` : ''}
  >
    <!-- Swipe-down hint -->
    <div class="swipe-hint">
      <div class="swipe-handle"></div>
    </div>

    <!-- Close -->
    <button class="viewer-close" on:click={close}>✕</button>

    <!-- Zoom controls (images only) -->
    {#if viewerAsset.type === 'IMAGE'}
      <div class="zoom-controls">
        <button class="zoom-btn" on:click={zoomOut} disabled={zoomScale <= 1} title="Zoom out">−</button>
        <button class="zoom-label" on:click={resetZoom} title="Reset zoom">{Math.round(zoomScale * 100)}%</button>
        <button class="zoom-btn" on:click={zoomIn} disabled={zoomScale >= 10} title="Zoom in">+</button>
      </div>
    {/if}

    <!-- Prev -->
    <button class="viewer-nav viewer-prev" on:click={prev} disabled={viewerIndex <= 0}>&#8592;</button>

    <!-- Media -->
    <div
      class="viewer-img-wrap"
      class:zoomed={zoomScale > 1}
      class:edit-shrink={editOpen}
      style="transform: scale({zoomScale}) translate({panX / zoomScale}px, {(panY + swipeDragY) / zoomScale}px); opacity: {swipeDragY > 0 ? Math.max(0.3, 1 - swipeDragY / 300) : 1}"
      on:mousedown={onPanStart}
    >
      {#if editPreviewUrl}
        <img class="viewer-img" src={editPreviewUrl} alt="Edit preview" draggable="false" />
        <div class="preview-badge">Preview</div>
      {:else if viewerAsset.type === 'VIDEO'}
        {#if videoError}
          <div class="video-error">
            <div class="video-error-icon">⚠</div>
            <p>Unable to play this video</p>
            <a class="vbtn" href={api.assets.downloadUrl(viewerAsset.id)} download={viewerAsset.fileName}>
              ⬇ Download instead
            </a>
          </div>
        {:else}
          <!-- svelte-ignore a11y-media-has-caption -->
          <video
            class="viewer-video"
            controls
            autoplay={$settings.videos.autoPlay}
            loop={$settings.videos.looping}
            poster={posterUrl(viewerAsset)}
            use:hlsPlayer={hlsUrl(viewerAsset)}
            on:click|stopPropagation
            bind:this={videoEl}
            on:loadedmetadata={() => {
              videoDuration = videoEl?.duration ?? 0;
              if (vep.trimEndSec === 0 && videoDuration > 0) vep = { ...vep, trimEndSec: videoDuration };
            }}
          ></video>
        {/if}
      {:else if viewerAsset.type === 'IMAGE'}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="live-photo-wrap"
          on:mousedown={startLive}
          on:mouseup={stopLive}
          on:mouseleave={stopLive}
          on:touchstart={startLive}
          on:touchend={stopLive}
          on:touchcancel={stopLive}
        >
          <img
            class="viewer-img live-still"
            class:live-faded={livePhotoPlaying && viewerAsset.isLivePhoto}
            src={fullUrl(viewerAsset)}
            alt={displayName(viewerAsset.fileName)}
            draggable="false"
          />
          {#if viewerAsset.isLivePhoto && viewerAsset.livePhotoVideoPath}
            <!-- svelte-ignore a11y-media-has-caption -->
            <video
              class="viewer-img live-video"
              class:live-visible={livePhotoPlaying}
              src={api.assets.liveVideoUrl(viewerAsset.id)}
              bind:this={liveVideoEl}
              muted
              loop
              playsinline
              preload="none"
            ></video>
            {#if !livePhotoPlaying}
              <div class="live-badge">
                <span class="live-badge-icon">&#9654;</span> LIVE
              </div>
            {/if}
          {/if}
        </div>
      {:else}
        <div class="viewer-broken">&#128196;</div>
      {/if}
    </div>

    <!-- Next -->
    <button class="viewer-nav viewer-next" class:shift-left={editOpen} on:click={next} disabled={viewerIndex >= assets.length - 1}>&#8594;</button>

    <!-- Bottom bar -->
    <div class="viewer-meta" class:edit-meta-shrink={editOpen}>
      <div class="viewer-info">
        <div class="viewer-fname">
          {displayName(viewerAsset.fileName)}
          {#if viewerAsset.isLivePhoto && viewerAsset.livePhotoVideoPath}<span class="live-tag">&#9654; Live</span>{/if}
          {#if viewerAsset.editedPath || (viewerAsset.editParams && Object.keys(viewerAsset.editParams).length > 0)}<span class="edited-badge">Edited</span>{/if}
        </div>
        <div class="viewer-sub">
          {formatSize(viewerAsset.fileSizeBytes)} &middot; {formatDate(viewerAsset.fileCreatedAt)}
          {#if viewerAsset.locationCity}
            &middot; {viewerAsset.locationCity}{viewerAsset.locationCountry ? `, ${viewerAsset.locationCountry}` : ''}
          {/if}
        </div>
      </div>

      <div class="viewer-actions">
        <button class="vbtn vbtn-info" class:vbtn-info-active={infoOpen} on:click={toggleInfo} title="Info">
          &#9432; Info
        </button>
        <a class="vbtn" href={api.assets.downloadUrl(viewerAsset.id)} download={viewerAsset.fileName} title="Download">
          &#11123; Download
        </a>
        {#if mode === 'default'}
          <button class="vbtn" class:share-copied={shareCopied} on:click={shareAsset} title="Share">
            {shareCopied ? '&#10003; Link Copied!' : '&#128279; Share'}
          </button>
          {#if viewerAsset.type === 'IMAGE' || viewerAsset.type === 'VIDEO'}
            <button class="vbtn vbtn-edit" class:vbtn-edit-active={editOpen} on:click={editOpen ? closeEdit : openEdit}>
              ✏ Edit
            </button>
          {/if}
          <button class="vbtn" class:fav-active={viewerAsset.isFavorite} on:click={toggleFavorite}>
            &#9829; {viewerAsset.isFavorite ? 'Unfavorite' : 'Favorite'}
          </button>
          <button class="vbtn" on:click={archiveAsset}>
            {viewerAsset.isArchived ? 'Unarchive' : 'Archive'}
          </button>
          <button class="vbtn danger" on:click={trashAsset}>Trash</button>
        {:else if mode === 'trash'}
          <button class="vbtn" on:click={restoreAsset}>Restore</button>
          <button class="vbtn danger" on:click={permanentDelete}>Delete permanently</button>
        {/if}
      </div>
    </div>

    <!-- ── Info Panel (location map + details) ────────────────────────────── -->
    {#if infoOpen && viewerAsset}
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="info-panel" on:click|stopPropagation>
        <div class="info-panel-header">
          <span class="info-panel-title">Details</span>
          <button class="info-panel-close" on:click={() => infoOpen = false}>✕</button>
        </div>
        <div class="info-panel-body">
          <div class="info-row">
            <span class="info-label">File</span>
            <span class="info-value">{displayName(viewerAsset.fileName)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Date</span>
            <span class="info-value">{new Date(viewerAsset.fileCreatedAt).toLocaleString()}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Size</span>
            <span class="info-value">{formatSize(viewerAsset.fileSizeBytes)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Type</span>
            <span class="info-value">{viewerAsset.mimeType}</span>
          </div>
          {#if viewerAsset.locationCity || viewerAsset.locationCountry}
            <div class="info-row">
              <span class="info-label">Location</span>
              <span class="info-value">
                {[viewerAsset.locationCity, viewerAsset.locationCountry].filter(Boolean).join(', ')}
              </span>
            </div>
          {/if}
          {#if viewerAsset.locationLat != null && viewerAsset.locationLng != null}
            <div class="info-row">
              <span class="info-label">GPS</span>
              <span class="info-value" style="font-size:0.72rem">{viewerAsset.locationLat.toFixed(5)}, {viewerAsset.locationLng.toFixed(5)}</span>
            </div>
            <div class="info-map-wrap">
              <a href={mapLinkUrl(viewerAsset.locationLat, viewerAsset.locationLng)} target="_blank" rel="noopener noreferrer">
                <iframe
                  title="Photo location"
                  class="info-map-iframe"
                  src={mapEmbedUrl(viewerAsset.locationLat, viewerAsset.locationLng)}
                  frameborder="0"
                  scrolling="no"
                ></iframe>
                <div class="info-map-link">Open in OpenStreetMap &#8599;</div>
              </a>
            </div>
          {:else}
            <div class="info-no-location">No location data available</div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- ── Edit Panel ─────────────────────────────────────────────────────── -->
    {#if editOpen}
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="edit-panel" on:click|stopPropagation>

        <div class="edit-header">
          <span class="edit-title">{viewerAsset.type === 'VIDEO' ? '🎬 Video Edit' : cropMode ? '✂ Crop Image' : '✏ Edit'}</span>
          <button class="edit-close" on:click={closeEdit} title="Close">✕</button>
        </div>

        {#if viewerAsset.type === 'VIDEO'}
          <!-- ══ VIDEO EDIT PANEL ═══════════════════════════════════════════ -->
          <div class="edit-body" style="flex:1;overflow-y:auto">

            <!-- Auto Enhance -->
            <div class="vedit-section">
              <button
                class="vedit-enhance-btn"
                class:active={vep.autoEnhance}
                on:click={() => vep = { ...vep, autoEnhance: !vep.autoEnhance, brightness: 0, contrast: 0, saturation: 0 }}>
                ✨ Auto Enhance {vep.autoEnhance ? '(On)' : ''}
              </button>
            </div>

            <!-- Trim -->
            <div class="vedit-section">
              <p class="section-title">✂ Trim</p>
              {#if videoDuration > 0}
                <div class="trim-labels">
                  <span>Start: {vep.trimStartSec.toFixed(1)}s</span>
                  <span>End: {(vep.trimEndSec || videoDuration).toFixed(1)}s</span>
                  <span>Duration: {((vep.trimEndSec || videoDuration) - vep.trimStartSec).toFixed(1)}s</span>
                </div>
                <div class="slider-row">
                  <div class="slider-lbl"><span>▶ Start</span><span class="slider-val">{vep.trimStartSec.toFixed(1)}s</span></div>
                  <input type="range" min="0" max={videoDuration} step="0.1"
                    value={vep.trimStartSec}
                    on:input={(e) => vep = { ...vep, trimStartSec: Math.min(Number(e.currentTarget.value), (vep.trimEndSec || videoDuration) - 0.5) }} />
                </div>
                <div class="slider-row">
                  <div class="slider-lbl"><span>⏹ End</span><span class="slider-val">{(vep.trimEndSec || videoDuration).toFixed(1)}s</span></div>
                  <input type="range" min="0" max={videoDuration} step="0.1"
                    value={vep.trimEndSec || videoDuration}
                    on:input={(e) => vep = { ...vep, trimEndSec: Math.max(Number(e.currentTarget.value), vep.trimStartSec + 0.5) }} />
                </div>
                <button class="aspect-btn" on:click={() => vep = { ...vep, trimStartSec: 0, trimEndSec: videoDuration }}>Reset Trim</button>
              {:else}
                <p style="color:#888;font-size:0.8rem">Play the video to enable trim controls</p>
              {/if}
            </div>

            <!-- Filters -->
            <div class="vedit-section">
              <p class="section-title">🎨 Filter</p>
              <div class="filter-grid" style="grid-template-columns:repeat(3,1fr)">
                {#each ['none','noir','vivid','dramatic','warm','cool','fade','vintage','film','cinematic','chrome','matte','instant','process','transfer','silvertone'] as f}
                  <button class="filter-btn" class:active={vep.filter === f}
                    on:click={() => vep = { ...vep, filter: f }}>
                    {f === 'none' ? 'Original' : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                {/each}
              </div>
            </div>

            <!-- Color Adjustments (disabled when auto-enhance is on) -->
            <div class="vedit-section" class:vedit-disabled={vep.autoEnhance}>
              <p class="section-title">💡 Color Adjustments</p>
              <div class="slider-row">
                <div class="slider-lbl"><span>Brightness</span><span class="slider-val">{vep.brightness}</span></div>
                <input type="range" min="-100" max="100" step="1" value={vep.brightness} disabled={vep.autoEnhance}
                  on:input={(e) => vep = { ...vep, brightness: Number(e.currentTarget.value) }} />
              </div>
              <div class="slider-row">
                <div class="slider-lbl"><span>Contrast</span><span class="slider-val">{vep.contrast}</span></div>
                <input type="range" min="-100" max="100" step="1" value={vep.contrast} disabled={vep.autoEnhance}
                  on:input={(e) => vep = { ...vep, contrast: Number(e.currentTarget.value) }} />
              </div>
              <div class="slider-row">
                <div class="slider-lbl"><span>Saturation</span><span class="slider-val">{vep.saturation}</span></div>
                <input type="range" min="-100" max="100" step="1" value={vep.saturation} disabled={vep.autoEnhance}
                  on:input={(e) => vep = { ...vep, saturation: Number(e.currentTarget.value) }} />
              </div>
            </div>

            <!-- Speed -->
            <div class="vedit-section">
              <p class="section-title">⏩ Speed</p>
              <div class="speed-btns">
                {#each [0.25, 0.5, 1.0, 1.5, 2.0, 4.0] as s}
                  <button class="aspect-btn" class:active={vep.speed === s}
                    on:click={() => vep = { ...vep, speed: s }}>
                    {s}×
                  </button>
                {/each}
              </div>
            </div>

            <!-- Mute -->
            <div class="vedit-section">
              <button class="vedit-enhance-btn" class:active={vep.muted}
                on:click={() => vep = { ...vep, muted: !vep.muted }}>
                {vep.muted ? '🔇 Audio Muted' : '🔊 Mute Audio'}
              </button>
            </div>

          </div>

          {#if editError}<p class="edit-error">{editError}</p>{/if}

          <div class="edit-footer">
            {#if editSavedMsg}
              <div class="save-success">✓ Video saved — edits applied</div>
              <button class="efoot-btn save-btn" on:click={closeEdit} style="grid-column:2">Done</button>
              {#if viewerAsset.editParams && Object.keys(viewerAsset.editParams).length > 0}
                <button class="efoot-btn revert-btn" on:click={doRevert} disabled={editReverting}>{editReverting ? '⟳ Reverting…' : '↩ Revert'}</button>
              {/if}
            {:else}
              <button class="efoot-btn save-btn" on:click={doVideoSave} disabled={editSaving}>
                {editSaving ? '⟳ Processing…' : '💾 Save Video Edit'}
              </button>
              {#if viewerAsset.editParams && Object.keys(viewerAsset.editParams).length > 0}
                <button class="efoot-btn revert-btn" on:click={doRevert} disabled={editReverting}>{editReverting ? '⟳ Reverting…' : '↩ Revert'}</button>
              {/if}
              <button class="efoot-btn cancel-btn" on:click={closeEdit}>Cancel</button>
            {/if}
          </div>

        {:else if cropMode}
          <!-- ══ CROP MODE ══════════════════════════════════════════════════ -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="crop-interface">
            <div class="crop-wrap"
              bind:this={cropContainerEl}
              style="aspect-ratio:{cropNatW + '/' + cropNatH}"
              on:mousedown={onCropMouseDown}
              on:mousemove={onCropMouseMove}
              on:mouseup={onCropMouseUp}
              on:mouseleave={onCropMouseUp}
              on:touchstart|passive={onCropTouchStart}
              on:touchmove|passive={onCropTouchMove}
              on:touchend={onCropTouchEnd}>

              <img
                src={editPreviewUrl || fullUrl(viewerAsset)}
                alt="Crop"
                class="crop-img"
                draggable="false"
                on:load={onCropImgLoad}
              />

              {#if ep.crop && ep.crop.width > 0.005 && ep.crop.height > 0.005}
                <!-- Shade outside crop -->
                <div class="cs" style="top:0;left:0;right:0;height:{ep.crop.top*100}%"></div>
                <div class="cs" style="top:{(ep.crop.top+ep.crop.height)*100}%;left:0;right:0;bottom:0"></div>
                <div class="cs" style="top:{ep.crop.top*100}%;left:0;width:{ep.crop.left*100}%;height:{ep.crop.height*100}%"></div>
                <div class="cs" style="top:{ep.crop.top*100}%;left:{(ep.crop.left+ep.crop.width)*100}%;right:0;height:{ep.crop.height*100}%"></div>
                <!-- Crop box -->
                <div class="crop-box" style="left:{ep.crop.left*100}%;top:{ep.crop.top*100}%;width:{ep.crop.width*100}%;height:{ep.crop.height*100}%">
                  <div class="cg ch" style="top:33.3%"></div>
                  <div class="cg ch" style="top:66.6%"></div>
                  <div class="cg cv" style="left:33.3%"></div>
                  <div class="cg cv" style="left:66.6%"></div>
                  <div class="cc tl"></div><div class="cc tr"></div>
                  <div class="cc bl"></div><div class="cc br"></div>
                </div>
              {:else}
                <div class="crop-hint-overlay">Drag to select area</div>
              {/if}
            </div>

            <!-- Aspect ratio presets -->
            <div class="crop-aspects">
              {#each [['Free','free'],['1:1','1:1'],['4:3','4:3'],['16:9','16:9'],['3:2','3:2'],['9:16','9:16']] as [lbl, val]}
                <button class="aspect-btn" class:active={cropAspect === val}
                  on:click={() => { cropAspect = val; ep = { ...ep, crop: null }; }}>
                  {lbl}
                </button>
              {/each}
            </div>

            <p class="crop-info">
              {#if ep.crop && ep.crop.width > 0.005}
                {(ep.crop.width*100).toFixed(0)}% × {(ep.crop.height*100).toFixed(0)}% &nbsp;·&nbsp;
                from ({(ep.crop.left*100).toFixed(0)}%, {(ep.crop.top*100).toFixed(0)}%)
              {:else}
                Drag to define crop area
              {/if}
            </p>
          </div>

          <!-- Crop footer -->
          <div class="edit-footer">
            <button class="efoot-btn cancel-btn" on:click={cancelCrop}>✕ Cancel</button>
            <button class="efoot-btn save-btn" on:click={applyCrop}
              disabled={!ep.crop || ep.crop.width < 0.02}>✓ Apply Crop</button>
          </div>

        {:else}
          <!-- ══ NORMAL EDIT MODE ════════════════════════════════════════════ -->

          <!-- Live preview thumbnail -->
          <div class="edit-preview-thumb" class:has-preview={editPreviewUrl || editPreviewing}>
            {#if editPreviewing}
              <div class="preview-spinner">⟳ Updating…</div>
            {:else if editPreviewUrl}
              <img src={editPreviewUrl} alt="Preview" />
            {/if}
          </div>

          <!-- Tabs -->
          <div class="edit-tabs">
            {#each ['actions','filters','lighting','colors'] as tab}
              <button
                class="edit-tab"
                class:active={editTab === tab}
                on:click={() => setEditTab(tab)}
              >{capLabel(tab)}</button>
            {/each}
          </div>

          <!-- Tab body -->
          <div class="edit-body">

            <!-- ── Actions ── -->
            {#if editTab === 'actions'}
              {#each ACTION_SLIDERS as s}
                <div class="slider-row">
                  <div class="slider-lbl">
                    <span>{s.icon} {s.label}</span>
                    <span class="slider-val">{ep[s.key]}</span>
                  </div>
                  <input type="range" min="0" max="100" step="1"
                    value={ep[s.key]}
                    on:input={(e) => ep = { ...ep, [s.key]: Number(e.currentTarget.value) }} />
                </div>
              {/each}

              <!-- Rotation section -->
              <div class="crop-action-section">
                <p class="section-title" style="margin-top:1rem;margin-bottom:0.5rem">↻ Rotation</p>
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
                  {#each [0, 90, 180, 270] as deg}
                    <button
                      class="filter-btn"
                      class:active={ep.rotation === deg}
                      on:click={() => ep = { ...ep, rotation: deg }}
                      style="flex:1;min-width:3rem">
                      {deg === 0 ? 'None' : deg + '°'}
                    </button>
                  {/each}
                </div>
              </div>

              <!-- Crop section -->
              <div class="crop-action-section">
                <p class="section-title" style="margin-top:1rem;margin-bottom:0.5rem">✂ Crop</p>
                {#if ep.crop}
                  <div class="crop-active-row">
                    <span>Crop active · {(ep.crop.width*100).toFixed(0)}% × {(ep.crop.height*100).toFixed(0)}%</span>
                    <button on:click={() => ep = { ...ep, crop: null }} title="Remove crop">×</button>
                  </div>
                {/if}
                <button class="crop-btn" on:click={openCropMode}>
                  {ep.crop ? '✂ Adjust Crop' : '✂ Crop Image'}
                </button>
              </div>

            <!-- ── Filters ── -->
            {:else if editTab === 'filters'}
              <p class="section-title">Filters</p>
              <div class="filter-grid">
                {#each FILTERS as f}
                  <button
                    class="filter-btn"
                    class:active={ep.filter === f}
                    on:click={() => ep = { ...ep, filter: f }}
                  >{f === 'none' ? 'None' : capLabel(f)}</button>
                {/each}
              </div>

              {#if ep.filter !== 'none'}
                <div class="slider-row" style="margin-top:0.75rem">
                  <div class="slider-lbl">
                    <span>Intensity</span>
                    <span class="slider-val">{ep.filterIntensity}%</span>
                  </div>
                  <input type="range" min="0" max="100" step="1"
                    value={ep.filterIntensity}
                    on:input={(e) => ep = { ...ep, filterIntensity: Number(e.currentTarget.value) }} />
                </div>
              {/if}

              <p class="section-title" style="margin-top:1.25rem">Sky Style</p>
              <div class="filter-grid">
                {#each SKY_STYLES as sky}
                  <button
                    class="filter-btn"
                    class:active={ep.skyStyle === sky}
                    on:click={() => ep = { ...ep, skyStyle: sky }}
                  >{sky === 'none' ? 'None' : capLabel(sky)}</button>
                {/each}
              </div>

              {#if ep.skyStyle !== 'none'}
                <div class="slider-row" style="margin-top:0.75rem">
                  <div class="slider-lbl">
                    <span>Sky Intensity</span>
                    <span class="slider-val">{ep.skyIntensity}%</span>
                  </div>
                  <input type="range" min="0" max="100" step="1"
                    value={ep.skyIntensity}
                    on:input={(e) => ep = { ...ep, skyIntensity: Number(e.currentTarget.value) }} />
                </div>
              {/if}

            <!-- ── Lighting ── -->
            {:else if editTab === 'lighting'}
              <div class="toggle-row">
                <button class="toggle-btn" class:active={ep.hdr}
                  on:click={() => ep = { ...ep, hdr: !ep.hdr }}>HDR</button>
                <button class="toggle-btn" class:active={ep.portraitLight}
                  on:click={() => ep = { ...ep, portraitLight: !ep.portraitLight }}>Portrait Light</button>
              </div>
              {#each LIGHTING_SLIDERS as s}
                <div class="slider-row">
                  <div class="slider-lbl">
                    <span>{s.label}</span>
                    <span class="slider-val">{ep[s.key]}</span>
                  </div>
                  <input type="range" min={s.min} max={s.max} step="1"
                    value={ep[s.key]}
                    on:input={(e) => ep = { ...ep, [s.key]: Number(e.currentTarget.value) }} />
                </div>
              {/each}

            <!-- ── Colors ── -->
            {:else if editTab === 'colors'}
              {#each COLOR_SLIDERS as s}
                <div class="slider-row">
                  <div class="slider-lbl">
                    <span>{s.label}</span>
                    <span class="slider-val">{ep[s.key]}</span>
                  </div>
                  <input type="range" min="-100" max="100" step="1"
                    value={ep[s.key]}
                    on:input={(e) => ep = { ...ep, [s.key]: Number(e.currentTarget.value) }} />
                </div>
              {/each}
            {/if}

          </div><!-- /edit-body -->

          {#if editError}
            <p class="edit-error">{editError}</p>
          {/if}

          <!-- Footer -->
          <div class="edit-footer">
            {#if editSavedMsg}
              <div class="save-success">✓ Edit saved</div>
              <button class="efoot-btn save-btn" on:click={closeEdit} style="grid-column:2">Done</button>
              {#if viewerAsset.editedPath}
                <button class="efoot-btn revert-btn" on:click={doRevert} disabled={editReverting}>{editReverting ? '⟳ Reverting…' : '↩ Revert'}</button>
              {/if}
            {:else}
              <button class="efoot-btn save-btn" on:click={doSave} disabled={editSaving || editPreviewing}>
                {editSaving ? '⟳ Saving…' : '💾 Save Edit'}
              </button>
              {#if viewerAsset.editedPath}
                <button class="efoot-btn revert-btn" on:click={doRevert} disabled={editReverting}>{editReverting ? '⟳ Reverting…' : '↩ Revert'}</button>
              {/if}
              <button class="efoot-btn cancel-btn" on:click={closeEdit}>Cancel</button>
            {/if}
          </div>

        {/if}<!-- /cropMode or VIDEO -->

      </div><!-- /edit-panel -->
    {/if}

  </div><!-- /viewer-backdrop -->
{/if}

<style>
  .viewer-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.92);
    z-index: 9999;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
    transition: background 0.2s ease;
    touch-action: none;
  }
  .viewer-backdrop.swipe-dragging {
    transition: none;
  }

  /* Media wrapper */
  .viewer-img-wrap {
    max-width: calc(100vw - 8rem);
    max-height: calc(100vh - 6rem);
    display: flex; align-items: center; justify-content: center;
    transform-origin: center center;
    will-change: transform;
    position: relative;
    transition: max-width 0.25s ease, transform 0.2s ease, opacity 0.2s ease;
    touch-action: none;
  }
  .swipe-dragging .viewer-img-wrap {
    transition: none;
  }
  .viewer-img-wrap.edit-shrink { max-width: calc(100vw - 8rem - 308px); }
  .viewer-img-wrap.zoomed        { cursor: grab; }
  .viewer-img-wrap.zoomed:active { cursor: grabbing; }

  .viewer-img {
    max-width: 100%;
    max-height: calc(100vh - 6rem);
    border-radius: 4px; display: block;
    object-fit: contain; user-select: none;
    -webkit-user-drag: none;
    touch-action: none;
  }
  .viewer-video {
    max-width: calc(100vw - 8rem);
    max-height: calc(100vh - 6rem);
    border-radius: 4px; display: block;
    outline: none; background: #000;
    touch-action: none;
  }
  .viewer-broken { font-size: 5rem; color: #333; }

  /* ── Live Photo ──────────────────────────────────────────────────────────── */
  .live-photo-wrap {
    position: relative; display: inline-block;
    cursor: pointer; user-select: none;
    touch-action: none;
  }
  .live-still {
    transition: opacity 0.18s ease;
  }
  .live-faded { opacity: 0; pointer-events: none; }
  .live-video {
    position: absolute; top: 0; left: 0;
    width: 100%; height: 100%;
    object-fit: contain;
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.18s ease;
    pointer-events: none;
  }
  .live-video.live-visible {
    opacity: 1;
    pointer-events: auto;
  }
  .live-badge {
    position: absolute; bottom: 0.75rem; left: 50%;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.52); color: #fff;
    font-size: 0.7rem; font-weight: 700; letter-spacing: 0.1em;
    padding: 0.22rem 0.75rem 0.22rem 0.55rem; border-radius: 999px;
    backdrop-filter: blur(6px);
    pointer-events: none;
    display: flex; align-items: center; gap: 0.3rem;
    animation: live-pulse 2.5s ease-in-out infinite;
  }
  .live-badge-icon { font-size: 0.6rem; }
  @keyframes live-pulse {
    0%, 100% { opacity: 0.85; }
    50% { opacity: 1; }
  }

  .preview-badge {
    position: absolute; top: 0.5rem; right: 0.5rem;
    background: rgba(0,0,0,0.75); color: #4ade80;
    font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em;
    padding: 0.2rem 0.55rem; border-radius: 4px;
  }

  /* ── Video edit panel ─────────────────────────────────────────────────── */
  .vedit-section { margin-bottom: 1rem; }
  .vedit-enhance-btn {
    width: 100%; padding: 0.55rem 0.75rem;
    background: #1e1e2e; border: 1px solid #374151;
    color: #d1d5db; border-radius: 6px; cursor: pointer;
    font-size: 0.875rem; font-weight: 600; text-align: left;
    transition: background 0.15s, border-color 0.15s;
  }
  .vedit-enhance-btn:hover { background: #252538; border-color: #4b5563; }
  .vedit-enhance-btn.active { background: #1a1740; border-color: #6366f1; color: #a5b4fc; }
  .vedit-disabled { opacity: 0.45; pointer-events: none; }
  .trim-labels {
    display: flex; gap: 0.5rem; flex-wrap: wrap;
    font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.5rem;
  }
  .speed-btns { display: flex; gap: 0.4rem; flex-wrap: wrap; }

  .video-error {
    display: flex; flex-direction: column; align-items: center;
    gap: 0.75rem; color: #fff; text-align: center; padding: 2rem;
  }
  .video-error-icon { font-size: 3rem; opacity: 0.7; }
  .video-error p { font-size: 0.95rem; color: #ccc; margin: 0; }

  /* Swipe-down hint handle */
  .swipe-hint {
    position: fixed; top: 0.5rem; left: 50%; transform: translateX(-50%);
    z-index: 10003; pointer-events: none;
  }
  .swipe-handle {
    width: 36px; height: 4px; border-radius: 2px;
    background: rgba(255,255,255,0.35);
  }

  /* Close button */
  .viewer-close {
    position: fixed; top: 1rem; right: 1rem;
    background: rgba(0,0,0,0.6); border: none; border-radius: 50%;
    color: #fff; width: 2.5rem; height: 2.5rem; font-size: 1.2rem;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    z-index: 10002;
  }
  .viewer-close:hover { background: rgba(255,255,255,0.15); }

  /* Prev / Next nav */
  .viewer-nav {
    position: fixed; top: 50%; transform: translateY(-50%);
    background: rgba(0,0,0,0.5); border: none; border-radius: 50%;
    color: #fff; width: 3rem; height: 3rem; font-size: 1.3rem;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    z-index: 10000; transition: right 0.25s ease;
  }
  .viewer-nav:hover:not(:disabled) { background: rgba(255,255,255,0.15); }
  .viewer-nav:disabled { opacity: 0.2; cursor: default; }
  .viewer-prev { left: 1rem; }
  .viewer-next { right: 1rem; }
  .viewer-next.shift-left { right: calc(308px + 1rem); }

  /* Bottom metadata + actions */
  .viewer-meta {
    position: fixed; bottom: 0; left: 0; right: 0;
    padding: 1rem 1.5rem;
    background: linear-gradient(to top, rgba(0,0,0,0.85), transparent);
    display: flex; align-items: flex-end; justify-content: space-between;
    z-index: 10000; transition: right 0.25s ease;
  }
  .viewer-meta.edit-meta-shrink { right: 308px; }

  .viewer-info { font-size: 0.9rem; color: #fff; }
  .viewer-fname { font-weight: 700; margin-bottom: 2px; display: flex; align-items: center; gap: 0.5rem; }
  .viewer-sub   { color: #aaa; font-size: 0.8rem; }
  .viewer-actions { display: flex; gap: 0.5rem; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }

  .edited-badge {
    background: #4f46e5; color: #fff;
    font-size: 0.65rem; font-weight: 600; letter-spacing: 0.05em;
    padding: 0.15rem 0.45rem; border-radius: 4px; text-transform: uppercase;
  }
  .live-tag {
    background: #0ea5e9; color: #fff;
    font-size: 0.65rem; font-weight: 700; letter-spacing: 0.05em;
    padding: 0.15rem 0.45rem; border-radius: 4px;
  }

  .vbtn {
    padding: 0.4rem 0.8rem; border-radius: 6px;
    border: 1px solid #444; background: rgba(0,0,0,0.5);
    color: #fff; font-size: 0.85rem; cursor: pointer;
    text-decoration: none; display: inline-flex; align-items: center;
  }
  .vbtn:hover         { background: rgba(255,255,255,0.1); }
  .vbtn.fav-active    { color: #f472b6; border-color: #f472b6; }
  .share-copied { color: #16a34a !important; border-color: #16a34a !important; }
  .vbtn.danger:hover  { border-color: #f87171; color: #f87171; }

  .vbtn-edit           { color: #a5b4fc; border-color: #4f46e5; }
  .vbtn-edit:hover     { background: rgba(99,102,241,0.2); }
  .vbtn-edit-active    { background: rgba(99,102,241,0.25); border-color: #818cf8; color: #c7d2fe; }

  /* Zoom controls */
  .zoom-controls {
    position: fixed; top: 1rem; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 0.25rem;
    background: rgba(0,0,0,0.6); border-radius: 8px; padding: 0.25rem 0.4rem;
    z-index: 10000;
  }
  .zoom-btn {
    background: transparent; border: none; color: #fff;
    width: 2rem; height: 2rem; font-size: 1.2rem; font-weight: 700;
    cursor: pointer; border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
  }
  .zoom-btn:hover:not(:disabled) { background: rgba(255,255,255,0.15); }
  .zoom-btn:disabled { opacity: 0.3; cursor: default; }
  .zoom-label {
    background: transparent; border: none; color: #ccc;
    font-size: 0.8rem; min-width: 3rem; text-align: center;
    cursor: pointer; padding: 0 0.25rem;
  }
  .zoom-label:hover { color: #fff; }

  /* ── Edit Panel ─────────────────────────────────────────────────────────── */
  .edit-panel {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: 308px;
    background: #0f0f0f;
    border-left: 1px solid #252525;
    z-index: 10001;
    display: flex; flex-direction: column;
    overflow: hidden;
    animation: ep-slide-in 0.22s ease;
  }
  @keyframes ep-slide-in {
    from { transform: translateX(100%); }
    to   { transform: translateX(0); }
  }

  .edit-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid #222;
    flex-shrink: 0;
  }
  .edit-title { font-size: 0.95rem; color: #e5e7eb; font-weight: 600; }
  .edit-close {
    background: none; border: none; color: #555; font-size: 1rem;
    cursor: pointer; padding: 0.25rem 0.4rem; border-radius: 4px; line-height: 1;
  }
  .edit-close:hover { color: #fff; background: rgba(255,255,255,0.08); }

  .edit-preview-thumb {
    position: relative; flex-shrink: 0;
    overflow: hidden; background: #111;
    border-bottom: 1px solid #222;
    height: 0; transition: height 0.2s ease;
    display: flex; align-items: center; justify-content: center;
  }
  .edit-preview-thumb.has-preview { height: 150px; }
  .edit-preview-thumb img { width: 100%; height: 100%; object-fit: contain; }
  .preview-spinner {
    color: #aaa; font-size: 0.85rem; letter-spacing: 0.04em;
    animation: spin-text 1s linear infinite;
  }
  @keyframes spin-text {
    0%   { opacity: 1; }
    50%  { opacity: 0.3; }
    100% { opacity: 1; }
  }

  /* Tabs */
  .edit-tabs {
    display: flex; flex-shrink: 0;
    border-bottom: 1px solid #222;
  }
  .edit-tab {
    flex: 1; padding: 0.55rem 0.2rem;
    background: none; border: none; border-bottom: 2px solid transparent;
    color: #555; font-size: 0.7rem; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.05em;
    cursor: pointer; transition: color 0.15s, border-color 0.15s;
  }
  .edit-tab:hover { color: #aaa; }
  .edit-tab.active { color: #c7d2fe; border-bottom-color: #6366f1; }

  /* Body */
  .edit-body { flex: 1; overflow-y: auto; padding: 1rem; }

  .section-title {
    font-size: 0.68rem; font-weight: 700; letter-spacing: 0.07em;
    text-transform: uppercase; color: #555;
    margin: 0 0 0.75rem;
  }
  .edit-hint { font-size: 0.72rem; color: #444; font-style: italic; margin-top: 0.75rem; }

  /* Filter grid */
  .filter-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.4rem; }
  .filter-btn {
    padding: 0.45rem 0.15rem; text-align: center;
    background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 6px;
    color: #999; font-size: 0.7rem; cursor: pointer; transition: all 0.15s;
  }
  .filter-btn:hover { background: #222; color: #ddd; }
  .filter-btn.active { background: #1a1740; border-color: #6366f1; color: #a5b4fc; font-weight: 700; }

  /* Toggle row */
  .toggle-row { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
  .toggle-btn {
    flex: 1; padding: 0.45rem;
    background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 6px;
    color: #999; font-size: 0.78rem; cursor: pointer; transition: all 0.15s;
  }
  .toggle-btn:hover  { background: #222; color: #ddd; }
  .toggle-btn.active { background: #1a1740; border-color: #6366f1; color: #a5b4fc; font-weight: 600; }

  /* Sliders */
  .slider-row { margin-bottom: 0.9rem; }
  .slider-lbl {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 0.3rem; font-size: 0.78rem; color: #bbb;
  }
  .slider-val { color: #666; font-size: 0.72rem; min-width: 2.5rem; text-align: right; }

  input[type="range"] {
    width: 100%; -webkit-appearance: none; appearance: none;
    height: 3px; border-radius: 2px;
    background: #2a2a2a; outline: none; cursor: pointer;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; width: 14px; height: 14px;
    background: #6366f1; border-radius: 50%; cursor: pointer;
  }
  input[type="range"]::-moz-range-thumb {
    width: 14px; height: 14px; background: #6366f1;
    border-radius: 50%; border: none; cursor: pointer;
  }

  /* Error */
  .edit-error {
    margin: 0; padding: 0.5rem 1rem;
    font-size: 0.75rem; color: #f87171;
    border-top: 1px solid #2a0000; background: #1a0000;
    flex-shrink: 0;
  }

  /* Footer */
  .edit-footer {
    padding: 0.75rem 0.75rem;
    border-top: 1px solid #222;
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 0.4rem; flex-shrink: 0;
  }
  .efoot-btn {
    padding: 0.5rem 0.5rem; border-radius: 6px;
    font-size: 0.78rem; font-weight: 500; cursor: pointer; border: 1px solid #333;
    transition: all 0.15s;
  }
  .efoot-btn:disabled { opacity: 0.45; cursor: not-allowed; }

  .save-success {
    grid-column: 1 / -1;
    text-align: center; font-size: 0.85rem; font-weight: 700;
    color: #4ade80; padding: 0.4rem 0;
    background: rgba(74,222,128,0.08); border-radius: 6px;
    border: 1px solid rgba(74,222,128,0.25);
  }

  .preview-btn { background: #1a1a1a; color: #bbb; }
  .preview-btn:hover:not(:disabled) { background: #252525; color: #fff; }

  .save-btn { background: #4f46e5; color: #fff; border-color: #4f46e5; }
  .save-btn:hover:not(:disabled) { background: #4338ca; }

  .revert-btn { background: #1a0a0a; color: #f87171; border-color: #5a1a1a; }
  .revert-btn:hover { background: #240d0d; }

  .cancel-btn { background: #1a1a1a; color: #666; }
  .cancel-btn:hover { color: #bbb; }

  /* ── Crop mode ─────────────────────────────────────────────────────────── */
  .crop-interface {
    flex: 1; display: flex; flex-direction: column;
    overflow: hidden; min-height: 0;
  }

  .crop-wrap {
    position: relative; cursor: crosshair;
    background: #000; overflow: hidden;
    flex-shrink: 1; min-height: 0;
    max-height: 55vh; width: 100%;
    /* aspect-ratio set inline */
  }

  .crop-img {
    display: block; width: 100%; height: 100%;
    object-fit: fill; user-select: none; pointer-events: none;
    -webkit-user-drag: none;
  }

  /* Shade overlay outside selection */
  .cs {
    position: absolute; background: rgba(0,0,0,0.62); pointer-events: none;
  }

  /* Crop selection border */
  .crop-box {
    position: absolute; border: 1.5px solid #fff;
    box-sizing: border-box; pointer-events: none;
  }

  /* Rule-of-thirds grid lines */
  .cg { position: absolute; pointer-events: none; background: rgba(255,255,255,0.28); }
  .cg.ch { left: 0; right: 0; height: 1px; }
  .cg.cv { top: 0; bottom: 0; width: 1px; }

  /* Corner handles */
  .cc { position: absolute; width: 14px; height: 14px; border: 2.5px solid #fff; pointer-events: none; }
  .cc.tl { top: -1px; left: -1px; border-right: none; border-bottom: none; }
  .cc.tr { top: -1px; right: -1px; border-left: none; border-bottom: none; }
  .cc.bl { bottom: -1px; left: -1px; border-right: none; border-top: none; }
  .cc.br { bottom: -1px; right: -1px; border-left: none; border-top: none; }

  .crop-hint-overlay {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,0.35); font-size: 0.8rem; pointer-events: none;
  }

  /* Aspect ratio strip */
  .crop-aspects {
    display: flex; flex-wrap: wrap; gap: 0.35rem;
    padding: 0.55rem 0.75rem; border-bottom: 1px solid #222; flex-shrink: 0;
  }
  .aspect-btn {
    padding: 0.28rem 0.55rem; background: #1a1a1a;
    border: 1px solid #333; border-radius: 4px;
    color: #888; font-size: 0.7rem; cursor: pointer; transition: all 0.12s;
  }
  .aspect-btn:hover { background: #222; color: #ccc; }
  .aspect-btn.active { background: #1a1740; border-color: #6366f1; color: #a5b4fc; }

  .crop-info {
    padding: 0.35rem 0.75rem; font-size: 0.7rem;
    color: #555; text-align: center; flex-shrink: 0;
  }

  /* Crop button in Actions tab */
  .crop-action-section { margin-top: 0.25rem; }

  .crop-active-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.35rem 0.6rem; margin-bottom: 0.4rem;
    background: #0d1f3c; border: 1px solid #1e3a6e; border-radius: 6px;
    font-size: 0.73rem; color: #7bb3ff;
  }
  .crop-active-row button {
    background: none; border: none; color: #555;
    cursor: pointer; font-size: 1.1rem; line-height: 1; padding: 0 0.15rem;
  }
  .crop-active-row button:hover { color: #f87171; }

  .crop-btn {
    width: 100%; padding: 0.5rem;
    background: #1a1a1a; border: 1px solid #333; border-radius: 6px;
    color: #aaa; font-size: 0.8rem; cursor: pointer; transition: all 0.15s;
    text-align: center;
  }
  .crop-btn:hover { background: #252525; color: #fff; border-color: #555; }

  /* ── Info button ─────────────────────────────────────────────────────────── */
  .vbtn-info { color: #93c5fd; border-color: #3b82f6; }
  .vbtn-info:hover { background: rgba(59,130,246,0.2); }
  .vbtn-info-active { background: rgba(59,130,246,0.25); border-color: #60a5fa; color: #bfdbfe; }

  /* ── Info Panel ──────────────────────────────────────────────────────────── */
  .info-panel {
    position: fixed; top: 0; left: 0; bottom: 0;
    width: 320px;
    background: #0f0f0f;
    border-right: 1px solid #252525;
    z-index: 10001;
    display: flex; flex-direction: column;
    overflow: hidden;
    animation: ip-slide-in 0.22s ease;
  }
  @keyframes ip-slide-in {
    from { transform: translateX(-100%); }
    to   { transform: translateX(0); }
  }
  .info-panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid #222;
    flex-shrink: 0;
  }
  .info-panel-title { font-size: 0.95rem; color: #e5e7eb; font-weight: 600; }
  .info-panel-close {
    background: none; border: none; color: #555; font-size: 1rem;
    cursor: pointer; padding: 0.25rem 0.4rem; border-radius: 4px; line-height: 1;
  }
  .info-panel-close:hover { color: #fff; background: rgba(255,255,255,0.08); }

  .info-panel-body {
    flex: 1; overflow-y: auto; padding: 1rem;
  }
  .info-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.5rem 0;
    border-bottom: 1px solid #1a1a1a;
  }
  .info-label {
    font-size: 0.78rem; font-weight: 600; color: #666;
    flex-shrink: 0; min-width: 70px;
  }
  .info-value {
    font-size: 0.82rem; color: #ccc;
    text-align: right; word-break: break-all;
  }
  .info-map-wrap {
    margin-top: 0.75rem; border-radius: 8px; overflow: hidden;
    border: 1px solid #333;
  }
  .info-map-wrap a { display: block; text-decoration: none; }
  .info-map-iframe {
    width: 100%; height: 200px; border: none;
    pointer-events: none;
  }
  .info-map-link {
    display: block; text-align: center; padding: 0.4rem;
    font-size: 0.72rem; color: #93c5fd;
    background: #111; border-top: 1px solid #333;
  }
  .info-map-wrap a:hover .info-map-link { color: #bfdbfe; background: #1a1a2e; }
  .info-no-location {
    margin-top: 0.75rem; padding: 1rem;
    text-align: center; color: #444; font-size: 0.82rem;
    background: #111; border-radius: 8px; border: 1px solid #222;
  }
</style>
