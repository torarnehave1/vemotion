import type { CompositionData } from './api';
import { CanvasRenderer } from './renderer';

/**
 * Render one frame of the composition at full resolution and download it as a
 * PNG — a screenshot of the current canvas (used for the knitting chart, but
 * works for any composition). Mirrors the offscreen-canvas setup in
 * thumbnail.ts and the anchor-click download in exporter.ts.
 *
 * Captures the given frame (the editor passes the current playhead frame).
 * Image and video layers are preloaded first so they appear; video layers are
 * seeked to this frame's source time so the screenshot matches the canvas.
 * Layers that fetch assets inside their draw call (kg-shape, card) may render
 * empty on the first call.
 */
export async function exportFramePng(
  composition: CompositionData,
  frameNumber = 0,
  fileName = 'vemotion-frame.png',
): Promise<void> {
  if (!composition || composition.width <= 0 || composition.height <= 0) {
    throw new Error('Invalid composition dimensions');
  }

  const blob = await captureFramePngBlob(composition, frameNumber);

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export one PNG per carousel slide. `slideTimes` are capture times in
 * seconds (see CompositionMeta.carousel); each is rendered through the same
 * full-resolution path as exportFramePng and downloaded as
 * `<fileBase>-01.png`, `<fileBase>-02.png`, …
 *
 * Downloads run sequentially with a short gap — browsers throttle or block
 * bursts of programmatic anchor clicks, and the renderer setup per capture
 * is not free anyway.
 */
export async function exportSlidesPng(
  composition: CompositionData,
  slideTimes: number[],
  fileBase = 'slide',
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (!composition || composition.width <= 0 || composition.height <= 0) {
    throw new Error('Invalid composition dimensions');
  }
  if (slideTimes.length === 0) throw new Error('No slide times to export');

  for (let i = 0; i < slideTimes.length; i++) {
    const frame = Math.max(0, Math.round(slideTimes[i] * composition.fps));
    const blob = await captureFramePngBlob(composition, frame);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileBase}-${String(i + 1).padStart(2, '0')}.png`;
    a.click();
    URL.revokeObjectURL(url);
    onProgress?.(i + 1, slideTimes.length);
    if (i < slideTimes.length - 1) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }
}

/**
 * The capture times for a composition's slides: the explicit
 * `meta.carousel.slideTimes` when present, otherwise one slide per whole
 * second of duration captured at the mid-second (0.5, 1.5, …) so entry
 * animations have settled.
 */
export function carouselSlideTimes(composition: CompositionData): number[] {
  const explicit = composition.meta?.carousel?.slideTimes;
  if (Array.isArray(explicit) && explicit.length > 0) return explicit;
  const n = Math.max(1, Math.floor(composition.duration));
  return Array.from({ length: n }, (_, k) => k + 0.5);
}

/**
 * Render one frame to a PNG Blob (no download). Same rendering path as
 * exportFramePng — used to save a screenshot to the photo album.
 */
export async function captureFramePngBlob(
  composition: CompositionData,
  frameNumber = 0,
): Promise<Blob> {
  if (!composition || composition.width <= 0 || composition.height <= 0) {
    throw new Error('Invalid composition dimensions');
  }
  const canvas = document.createElement('canvas');
  const renderer = new CanvasRenderer(canvas);
  await renderer.preloadImages(composition);
  await renderer.preloadFonts(composition);
  await renderer.preloadVideos(composition);
  // Seek video layers to this frame's time so the captured frame is correct.
  await renderer.seekVideos(composition, frameNumber / composition.fps);
  renderer.renderFrame(composition, frameNumber);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  );
  if (!blob) throw new Error('Failed to encode PNG');
  return blob;
}
