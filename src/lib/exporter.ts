import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import type { CompositionData } from './api';
import { CanvasRenderer } from './renderer';

export type ExportProgress = {
  stage: 'loading' | 'rendering' | 'encoding' | 'done';
  percent: number;
  message: string;
};

const ffmpeg = new FFmpeg();
let loaded = false;

async function loadFFmpeg(onProgress?: (p: ExportProgress) => void) {
  if (loaded) return;

  onProgress?.({ stage: 'loading', percent: 0, message: 'Loading ffmpeg.wasm...' });

  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  loaded = true;
}

export async function exportToMp4(
  composition: CompositionData,
  onProgress?: (p: ExportProgress) => void
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = composition.width;
  canvas.height = composition.height;
  const renderer = new CanvasRenderer(canvas);

  const totalFrames = Math.ceil(composition.duration * composition.fps);

  await loadFFmpeg(onProgress);

  // Preload all image layers so frames render without blank placeholders
  onProgress?.({ stage: 'loading', percent: 10, message: 'Preloading images...' });
  await renderer.preloadImages(composition);

  // Render each frame and write to ffmpeg virtual filesystem
  for (let frame = 0; frame < totalFrames; frame++) {
    await renderer.renderFrame(composition, frame);

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png')
    );

    const frameName = `frame_${String(frame).padStart(6, '0')}.png`;
    await ffmpeg.writeFile(frameName, await fetchFile(blob));

    const percent = Math.round((frame / totalFrames) * 70);
    onProgress?.({
      stage: 'rendering',
      percent,
      message: `Rendering frame ${frame + 1} of ${totalFrames}`,
    });
  }

  onProgress?.({ stage: 'encoding', percent: 70, message: 'Encoding MP4...' });

  await ffmpeg.exec([
    '-framerate', String(composition.fps),
    '-i', 'frame_%06d.png',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    'output.mp4',
  ]);

  onProgress?.({ stage: 'encoding', percent: 95, message: 'Finalising...' });

  const data = await ffmpeg.readFile('output.mp4');
  const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'vemotion-export.mp4';
  a.click();
  URL.revokeObjectURL(url);

  // Clean up virtual filesystem
  for (let frame = 0; frame < totalFrames; frame++) {
    await ffmpeg.deleteFile(`frame_${String(frame).padStart(6, '0')}.png`);
  }
  await ffmpeg.deleteFile('output.mp4');

  onProgress?.({ stage: 'done', percent: 100, message: 'Export complete!' });
}
