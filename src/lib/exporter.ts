import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import type { CompositionData } from './api';
import { CanvasRenderer } from './renderer';
import { fetchAudioArrayBuffer } from './audioAnalysis';

export type ExportProgress = {
  stage: 'loading' | 'rendering' | 'encoding' | 'done';
  percent: number;
  message: string;
};

const ffmpeg = new FFmpeg();
let loaded = false;

// ffmpeg.exec() is one long blocking call with no built-in progress. The
// FFmpeg instance emits a 'progress' event (ratio 0..1) parsed from ffmpeg's
// own output during exec. Route it through a module-level sink set just before
// exec, so the encode stage shows real movement instead of a silent 70% wall.
let onEncodeProgress: ((ratio: number) => void) | null = null;
ffmpeg.on('progress', ({ progress }) => {
  if (onEncodeProgress) onEncodeProgress(progress);
});

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

  // Force fonts (incl. Devanagari) to fetch before drawing — the off-DOM export
  // canvas won't trigger Google Fonts' lazy @font-face on its own.
  await renderer.preloadFonts(composition);

  // Preload video layers into off-DOM <video> elements. Frames are drawn onto
  // the canvas (see the per-frame seekVideos below), so each video bakes into
  // the PNG sequence and respects layer z-order. The video's own audio is NOT
  // muxed here — audio comes from dedicated audio layers, matching the model.
  await renderer.preloadVideos(composition);

  // ── Audio layers: fetch each one into the ffmpeg vFS up front so the
  //     final mux command can reference them by name. Each layer becomes
  //     a separate -i input in the ffmpeg command and a filter-complex
  //     branch that adelays + trims + volumes its track. Failed fetches
  //     are skipped silently and the layer is omitted from the output —
  //     same fail-soft posture the editor playback takes.
  const audioInputs: AudioInput[] = [];
  const audioLayers = composition.layers.filter(l => l.type === 'audio' && l.visible !== false);
  if (audioLayers.length > 0) {
    onProgress?.({ stage: 'loading', percent: 15, message: `Fetching ${audioLayers.length} audio track(s)...` });
    for (let i = 0; i < audioLayers.length; i++) {
      const layer = audioLayers[i];
      const props = layer.properties as Record<string, unknown>;
      const url = typeof props.r2Url === 'string' ? props.r2Url : '';
      if (!url) continue;
      try {
        // Use fetchAudioArrayBuffer, NOT @ffmpeg/util's fetchFile: fetchFile
        // does not check res.ok, so a 404 (audio-portfolio-worker double-encode
        // bug) silently writes the HTML error page into the vFS, ffmpeg can't
        // demux it, exec fails, and readFile('output.mp4') throws ErrnoError.
        // fetchAudioArrayBuffer applies the %25 re-encode retry and throws on a
        // real failure so this layer falls through to the fail-soft catch.
        const buf = await fetchAudioArrayBuffer(url);
        // .webm is the recording format Contacts uses; the extension hint
        // helps ffmpeg pick a demuxer though it'll usually probe correctly.
        const inputName = `audio_${i}.webm`;
        await ffmpeg.writeFile(inputName, new Uint8Array(buf));
        const volRaw = props.volume;
        audioInputs.push({
          inputName,
          startSec: layer.startTime ?? 0,
          durationSec: layer.layerDuration ?? (composition.duration - (layer.startTime ?? 0)),
          volume: typeof volRaw === 'number' ? Math.max(0, Math.min(1, volRaw)) : 1,
        });
      } catch {
        /* fail-soft — that layer is silent in the export */
      }
    }
  }

  // Render each frame and write to ffmpeg virtual filesystem
  for (let frame = 0; frame < totalFrames; frame++) {
    // Seek every video layer to this frame's source time and await the seeks
    // so renderFrame draws the correct (not stale) video frame. No-op when the
    // composition has no video layers.
    await renderer.seekVideos(composition, frame / composition.fps);
    renderer.renderFrame(composition, frame);

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

  // Map ffmpeg's 0..1 encode progress onto the 70→95% band so the bar moves.
  onEncodeProgress = (ratio) => {
    const clamped = Math.max(0, Math.min(1, ratio));
    onProgress?.({
      stage: 'encoding',
      percent: 70 + Math.round(clamped * 25),
      message: `Encoding MP4... ${Math.round(clamped * 100)}%`,
    });
  };

  const ffmpegCmd = buildFfmpegCommand(composition.fps, composition.duration, audioInputs);
  try {
    await ffmpeg.exec(ffmpegCmd);
  } finally {
    onEncodeProgress = null;
  }

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
  for (const a of audioInputs) {
    try { await ffmpeg.deleteFile(a.inputName); } catch { /* ignore */ }
  }
  await ffmpeg.deleteFile('output.mp4');

  onProgress?.({ stage: 'done', percent: 100, message: 'Export complete!' });
}

// ── Audio mux helpers ──────────────────────────────────────────────────────────

interface AudioInput {
  inputName: string;
  startSec: number;
  durationSec: number;
  volume: number;
}

/**
 * Build the ffmpeg arg array. Three cases:
 *   - No audio inputs: just video, same command as before.
 *   - One audio input: -i audio + simple filter chain (adelay/atrim/volume),
 *     map [a0]. AAC encode at 192k. Output capped at composition.duration via -t.
 *   - Multiple audio inputs: each track gets its own filter branch, all
 *     branches feed into amix=normalize=0 for unattenuated mixing.
 *
 * `-shortest` is intentionally NOT used — we want the output to be exactly
 * composition.duration even if some audio tracks are shorter.
 */
function buildFfmpegCommand(fps: number, durationSec: number, audioInputs: AudioInput[]): string[] {
  const args: string[] = [
    '-framerate', String(fps),
    '-i', 'frame_%06d.png',
  ];
  for (const a of audioInputs) {
    args.push('-i', a.inputName);
  }

  if (audioInputs.length === 0) {
    args.push(
      '-c:v', 'libx264',
      // ffmpeg.wasm is single-threaded; the default 'medium' preset makes long
      // exports look frozen. 'ultrafast' cuts encode time dramatically at the
      // cost of a larger file (acceptable for browser-side export).
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-t', String(durationSec),
      'output.mp4',
    );
    return args;
  }

  // Build the filter graph. Each audio input becomes [aN] = adelay → atrim → volume.
  // For multiple inputs we then amix them into [mixed]. Input indices for audio
  // start at 1 because input 0 is the image sequence.
  const branches: string[] = [];
  const branchLabels: string[] = [];
  audioInputs.forEach((a, i) => {
    const ffmpegInputIdx = i + 1;
    const startMs = Math.max(0, Math.round(a.startSec * 1000));
    const label = `a${i}`;
    // adelay needs `ms|ms` for stereo (most common); for mono it ignores the
    // second value. atrim caps the audio at layerDuration so the layer
    // stops playing when its window ends. asetpts resets timestamps so the
    // delayed track aligns correctly.
    const branch =
      `[${ffmpegInputIdx}:a]` +
      `atrim=duration=${a.durationSec.toFixed(3)},` +
      `asetpts=PTS-STARTPTS,` +
      `adelay=${startMs}|${startMs},` +
      `volume=${a.volume.toFixed(3)}` +
      `[${label}]`;
    branches.push(branch);
    branchLabels.push(`[${label}]`);
  });

  let finalAudioLabel: string;
  if (audioInputs.length === 1) {
    finalAudioLabel = branchLabels[0];
  } else {
    // amix with normalize=0 keeps each track at its own (volume-filtered) level
    // instead of attenuating by 1/N (the default normalize=1 behaviour).
    branches.push(`${branchLabels.join('')}amix=inputs=${audioInputs.length}:normalize=0[mixed]`);
    finalAudioLabel = '[mixed]';
  }

  args.push(
    '-filter_complex', branches.join(';'),
    '-map', '0:v',
    '-map', finalAudioLabel,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-t', String(durationSec),
    'output.mp4',
  );
  return args;
}
