import type { CompositionData } from './api';
import { CanvasRenderer } from './renderer';

/**
 * Render one frame of the composition at full resolution and download it as a
 * PNG — a screenshot of the current canvas (used for the knitting chart, but
 * works for any composition). Mirrors the offscreen-canvas setup in
 * thumbnail.ts and the anchor-click download in exporter.ts.
 *
 * Defaults to frame 0, which is correct for a static chart. Image / video
 * layers are preloaded first so they appear; layers that fetch assets inside
 * their draw call (kg-shape, card) may render empty on the first call.
 */
export async function exportFramePng(
  composition: CompositionData,
  frameNumber = 0,
  fileName = 'knitting-chart.png',
): Promise<void> {
  if (!composition || composition.width <= 0 || composition.height <= 0) {
    throw new Error('Invalid composition dimensions');
  }

  const canvas = document.createElement('canvas');
  const renderer = new CanvasRenderer(canvas);
  await renderer.preloadImages(composition);
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
