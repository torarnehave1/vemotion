import type { CompositionData } from './api';
import { CanvasRenderer } from './renderer';

/**
 * Render frame 0 of the composition to an offscreen canvas at full resolution,
 * then downscale to a thumbnail and return as a PNG data URL. Used by the
 * Portfolio modal for lazy on-demand thumbnails (Q1A — no storage, no worker
 * round-trip; each visible card renders once when it intersects the viewport).
 *
 * Two-canvas approach: render at composition.width × composition.height
 * (CanvasRenderer.renderFrame overwrites the canvas dimensions to match the
 * composition), then `drawImage`-downscale onto a thumbnail-sized canvas.
 * Both canvases are GCed after this function returns.
 *
 * Image layers and text layers with `fillMode: 'image'` are preloaded via the
 * renderer's existing `preloadImages` path before rendering, so they appear in
 * the thumbnail (subject to CORS — failed loads silently render as empty).
 *
 * Video layers are preloaded too, with a time limit: a video layer is drawn from a
 * <video> element, and without this the element was only created during the render
 * and had no frame yet, so every composition with a full-canvas clip came out black.
 * A clip that cannot load in time is left out rather than holding the card on its
 * spinner. The elements are released afterwards so the clips stop downloading.
 *
 * Known limitation: `kg-shape` and `card` layers fetch SVG paths from the KG
 * worker inside their draw functions; those network calls are NOT awaited
 * here, so those layers render empty in the thumbnail on the first portfolio
 * open. Acceptable for v1.
 */
/** How long a thumbnail waits for its video layers before rendering without them. */
const VIDEO_PRELOAD_LIMIT_MS = 8000;

export async function renderThumbnail(
  composition: CompositionData,
  thumbnailWidth = 320,
): Promise<string> {
  if (!composition || composition.width <= 0 || composition.height <= 0) {
    throw new Error('Invalid composition dimensions');
  }

  const aspectRatio = composition.width / composition.height;
  const thumbHeight = Math.max(1, Math.round(thumbnailWidth / aspectRatio));

  // Full-resolution render canvas. CanvasRenderer.renderFrame internally
  // sets canvas.width / .height to composition.width / .height — so any
  // pre-sizing here would be overwritten anyway.
  const fullCanvas = document.createElement('canvas');
  const renderer = new CanvasRenderer(fullCanvas);

  await renderer.preloadImages(composition);
  await renderer.preloadFonts(composition);
  try {
    await Promise.race([
      renderer.preloadVideos(composition).then(() => renderer.seekVideos(composition, 0)),
      new Promise<void>((resolve) => setTimeout(resolve, VIDEO_PRELOAD_LIMIT_MS)),
    ]);
    renderer.renderFrame(composition, 0);
  } finally {
    renderer.disposeVideos();
  }

  // Downscale to thumbnail.
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = thumbnailWidth;
  thumbCanvas.height = thumbHeight;
  const thumbCtx = thumbCanvas.getContext('2d');
  if (!thumbCtx) throw new Error('No 2D context for thumbnail');
  // Smoothing for the downscale — yields cleaner small previews than the
  // default linear scale at extreme ratios (1280 → 320 is 4x).
  thumbCtx.imageSmoothingEnabled = true;
  thumbCtx.imageSmoothingQuality = 'high';
  thumbCtx.drawImage(fullCanvas, 0, 0, thumbnailWidth, thumbHeight);

  return thumbCanvas.toDataURL('image/png');
}
