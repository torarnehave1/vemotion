import type { AudioTrack } from './api';

/**
 * Audio amplitude analysis for the renderer's `amp` / `ampL` / `ampR`
 * context variables.
 *
 * Two entry points:
 *   - `analyseAudioFromUrl(url, sampleRate)` — fetches, decodes, analyses.
 *     Used by AudioLayerForm when the user adds an audio layer.
 *   - `analyseAudioBuffer(buffer, sampleRate)` — analyses a pre-decoded
 *     AudioBuffer (e.g. when the audio was just recorded in-browser).
 *
 * Plus `sampleAudioTrack(track, t)` for the renderer to look up amp values
 * at a given composition time with linear interpolation.
 */

/**
 * Fetch an audio file from a URL, decode it via Web Audio, and produce a
 * peak-normalized AudioTrack with left / right / mono channels sampled at
 * `sampleRate` Hz (default 30 — matches the typical composition fps).
 *
 * Throws on network error or on AudioContext.decodeAudioData rejection.
 * Caller should surface the error to the user.
 */
export async function fetchAudioArrayBuffer(url: string): Promise<ArrayBuffer> {
  let res = await fetch(url);
  // Defensive retry for the audio-portfolio-worker upload bug: some R2
  // keys were stored with the literal percent-escape characters baked in
  // (e.g. "SeljeFl%C3%B8yte.wav" — six literal ASCII chars where the
  // upload pipeline double-encoded the original `ø`). The recording's
  // r2Url single-encodes those, so a normal fetch decodes them back to
  // `ø` before R2 lookup and misses. Re-encoding each `%XX` as `%25XX`
  // restores the literal-percent form the R2 key actually carries.
  // Verified 2026-05-29 against rec_1780038560915_c11sbpqoe.
  if (!res.ok && res.status === 404 && /%[0-9A-Fa-f]{2}/.test(url)) {
    const recovered = url.replace(/%([0-9A-Fa-f]{2})/g, '%25$1');
    if (recovered !== url) {
      console.warn(
        'fetchAudioArrayBuffer: 404 on original URL, retrying with percent-re-encoded path (audio-portfolio-worker upload bug workaround)',
      );
      const retry = await fetch(recovered);
      if (retry.ok) {
        res = retry;
      }
    }
  }
  if (!res.ok) {
    throw new Error(`Audio fetch failed: HTTP ${res.status}`);
  }
  return res.arrayBuffer();
}

export async function analyseAudioFromUrl(
  url: string,
  sampleRate = 30,
): Promise<AudioTrack> {
  const arrayBuffer = await fetchAudioArrayBuffer(url);
  // Webkit prefix kept for older Safari versions; harmless on modern browsers.
  const Ctx =
    typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
  if (!Ctx) {
    throw new Error('Web Audio API not available in this environment');
  }
  const ctx = new Ctx();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    return analyseAudioBuffer(audioBuffer, sampleRate);
  } finally {
    void ctx.close();
  }
}

/**
 * Analyse a pre-decoded AudioBuffer. RMS amplitude per window of
 * `floor(buffer.sampleRate / outputSampleRate)` raw samples, computed
 * separately for the left channel, right channel (falls back to left if
 * the buffer is mono), and the mix. Then peak-normalized across all three
 * channels.
 *
 * RMS (root-mean-square) is the right perceptual choice — peak amplitude
 * over-emphasises transients; RMS tracks loudness.
 */
export function analyseAudioBuffer(
  buffer: AudioBuffer,
  sampleRate = 30,
): AudioTrack {
  const duration = buffer.duration;
  const numSamples = Math.max(1, Math.ceil(duration * sampleRate));
  const windowSize = Math.max(1, Math.floor(buffer.sampleRate / sampleRate));

  const leftData = buffer.getChannelData(0);
  const rightData = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : leftData;

  const left: number[] = new Array(numSamples);
  const right: number[] = new Array(numSamples);
  const mono: number[] = new Array(numSamples);

  let peak = 0;
  for (let i = 0; i < numSamples; i += 1) {
    const startIdx = i * windowSize;
    const endIdx = Math.min(startIdx + windowSize, leftData.length);

    let lSumSq = 0;
    let rSumSq = 0;
    let mSumSq = 0;
    let n = 0;
    for (let j = startIdx; j < endIdx; j += 1) {
      const lv = leftData[j] ?? 0;
      const rv = rightData[j] ?? 0;
      const mv = (lv + rv) / 2;
      lSumSq += lv * lv;
      rSumSq += rv * rv;
      mSumSq += mv * mv;
      n += 1;
    }
    const l = n > 0 ? Math.sqrt(lSumSq / n) : 0;
    const r = n > 0 ? Math.sqrt(rSumSq / n) : 0;
    const m = n > 0 ? Math.sqrt(mSumSq / n) : 0;
    left[i] = l;
    right[i] = r;
    mono[i] = m;
    if (l > peak) peak = l;
    if (r > peak) peak = r;
    if (m > peak) peak = m;
  }

  if (peak > 0) {
    for (let i = 0; i < numSamples; i += 1) {
      left[i] /= peak;
      right[i] /= peak;
      mono[i] /= peak;
    }
  }

  return {
    sampleRate,
    duration,
    left,
    right,
    mono,
  };
}

/**
 * Look up amplitude values at a given composition time with linear
 * interpolation between adjacent samples. Returns zeros if the track is
 * absent or empty. Clamps at both ends — querying before t=0 returns the
 * first sample; querying past the track length returns the last sample.
 *
 * This is the renderer's per-frame entry point. Called once per frame at
 * the top of renderFrame so every formula evaluation sees the same amp
 * values for that frame.
 */
export function sampleAudioTrack(
  track: AudioTrack | undefined,
  t: number,
): { amp: number; ampL: number; ampR: number } {
  if (!track || !track.mono.length) {
    return { amp: 0, ampL: 0, ampR: 0 };
  }
  const idxFloat = t * track.sampleRate;
  if (idxFloat <= 0) {
    return { amp: track.mono[0], ampL: track.left[0], ampR: track.right[0] };
  }
  const lastIdx = track.mono.length - 1;
  if (idxFloat >= lastIdx) {
    return { amp: track.mono[lastIdx], ampL: track.left[lastIdx], ampR: track.right[lastIdx] };
  }
  const i0 = Math.floor(idxFloat);
  const i1 = i0 + 1;
  const frac = idxFloat - i0;
  return {
    amp: track.mono[i0] * (1 - frac) + track.mono[i1] * frac,
    ampL: track.left[i0] * (1 - frac) + track.left[i1] * frac,
    ampR: track.right[i0] * (1 - frac) + track.right[i1] * frac,
  };
}

/**
 * Build a synthetic AudioTrack for smoke testing the renderer without
 * needing real audio. Produces a sine-modulated amplitude pattern across
 * all three channels (mono, left = mono shifted by π/4, right = mono
 * shifted by π/2) so visualisations driven by amp/ampL/ampR show three
 * distinct phase-shifted curves.
 *
 * Used in tests + demo compositions. Not called from the live UI flow.
 */
export function buildSyntheticAudioTrack(
  duration: number,
  sampleRate = 30,
  beatsPerSecond = 2,
): AudioTrack {
  const numSamples = Math.max(1, Math.ceil(duration * sampleRate));
  const left: number[] = new Array(numSamples);
  const right: number[] = new Array(numSamples);
  const mono: number[] = new Array(numSamples);
  const twoPi = Math.PI * 2;
  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate;
    const phase = twoPi * beatsPerSecond * t;
    // Each channel = a positive sine (offset + amplitude), peak-normalized.
    mono[i] = 0.5 + 0.5 * Math.sin(phase);
    left[i] = 0.5 + 0.5 * Math.sin(phase + Math.PI / 4);
    right[i] = 0.5 + 0.5 * Math.sin(phase + Math.PI / 2);
  }
  return { sampleRate, duration, left, right, mono };
}
