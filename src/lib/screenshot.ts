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

  const canvas = document.createElement('canvas');
  const renderer = new CanvasRenderer(canvas);
  await renderer.preloadImages(composition);
  await renderer.preloadVideos(composition);
  // Seek video layers to this frame's time so the captured frame is correct.
  await renderer.seekVideos(composition, frameNumber / composition.fps);
  renderer.renderFrame(composition, frameNumber);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  );
  if (!blob) throw new Error('Failed to encode PNG');

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
