import type { CompositionData } from './api';

/**
 * Audio playback companion to PlaybackController.
 *
 * The renderer is canvas-only — sound has no place in renderFrame. This
 * controller owns the `<audio>` elements (one per audio layer), keeps them
 * in sync with the visual clock, and exposes pause/stop/syncToTime so the
 * surrounding VideoPreview can drive them alongside the existing frame ticker.
 *
 * Sync strategy:
 *   - When the visual clock enters a layer's [startTime, startTime+layerDuration]
 *     window, the audio plays.
 *   - When it leaves, the audio pauses (and currentTime resets to 0 so the
 *     next pass starts cleanly — important for loops).
 *   - Drift correction: every syncToTime call checks the expected position
 *     vs actual currentTime and force-syncs if drift > 100 ms. Catches
 *     accumulating drift between rAF and the audio element's clock.
 */
export class AudioPlaybackController {
  private audios: Map<string, HTMLAudioElement> = new Map();
  private composition: CompositionData;

  constructor(composition: CompositionData) {
    this.composition = composition;
    this.rebuildAudios();
  }

  /**
   * Swap in a new composition. Removes audio elements for layers that no
   * longer exist, adds new ones for layers that just appeared. Preserves
   * unchanged elements so their loaded buffers don't have to refetch.
   */
  setComposition(composition: CompositionData): void {
    this.composition = composition;
    this.rebuildAudios();
  }

  private rebuildAudios(): void {
    const seen = new Set<string>();
    for (const layer of this.composition.layers) {
      if (layer.type !== 'audio') continue;
      const url = (layer.properties as Record<string, unknown>).r2Url as string | undefined;
      if (!url) continue;
      seen.add(layer.id);
      const existing = this.audios.get(layer.id);
      const volRaw = (layer.properties as Record<string, unknown>).volume;
      const volume = typeof volRaw === 'number' ? Math.max(0, Math.min(1, volRaw)) : 1;
      if (existing && existing.src === url) {
        existing.volume = volume;
        continue;
      }
      // New or URL changed — replace
      if (existing) {
        existing.pause();
        existing.src = '';
      }
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.crossOrigin = 'anonymous';
      audio.volume = volume;
      this.audios.set(layer.id, audio);
    }
    // Drop audios whose layers were removed
    for (const id of [...this.audios.keys()]) {
      if (!seen.has(id)) {
        const a = this.audios.get(id);
        if (a) { a.pause(); a.src = ''; }
        this.audios.delete(id);
      }
    }
  }

  /**
   * Reconcile every audio layer's playback state with the visual clock.
   * Called from VideoPreview on each frame tick and on user actions
   * (play/pause/seek). `isPlaying` is the visual playback state.
   */
  syncToTime(time: number, isPlaying: boolean): void {
    for (const layer of this.composition.layers) {
      if (layer.type !== 'audio') continue;
      if (layer.visible === false) {
        const a = this.audios.get(layer.id);
        if (a && !a.paused) a.pause();
        continue;
      }
      const audio = this.audios.get(layer.id);
      if (!audio) continue;
      const startTime = layer.startTime ?? 0;
      const layerDuration = layer.layerDuration ?? (this.composition.duration - startTime);
      const endTime = startTime + layerDuration;

      // Outside window → silent.
      if (time < startTime || time >= endTime) {
        if (!audio.paused) audio.pause();
        if (audio.currentTime !== 0) audio.currentTime = 0;
        continue;
      }

      const expected = time - startTime;
      const drift = Math.abs(audio.currentTime - expected);
      if (drift > 0.1) {
        try { audio.currentTime = expected; } catch { /* not seekable yet */ }
      }

      if (isPlaying && audio.paused) {
        audio.play().catch(() => { /* autoplay blocked etc. */ });
      } else if (!isPlaying && !audio.paused) {
        audio.pause();
      }
    }
  }

  pauseAll(): void {
    for (const a of this.audios.values()) a.pause();
  }

  stopAll(): void {
    for (const a of this.audios.values()) {
      a.pause();
      try { a.currentTime = 0; } catch { /* not seekable */ }
    }
  }

  destroy(): void {
    for (const a of this.audios.values()) {
      a.pause();
      a.src = '';
    }
    this.audios.clear();
  }
}
