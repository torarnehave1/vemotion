import type { CompositionData, Layer, Keyframe } from './api';

// ── Interpolation ─────────────────────────────────────────────────────────────

export function interpolate(keyframes: Keyframe[], time: number): number {
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) return keyframes[0].value as number;

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  if (time <= sorted[0].time) return sorted[0].value as number;
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value as number;

  const after = sorted.find(k => k.time > time)!;
  const before = sorted[sorted.indexOf(after) - 1];

  const progress = (time - before.time) / (after.time - before.time);
  const eased = easeInOut(progress);

  return (before.value as number) + ((after.value as number) - (before.value as number)) * eased;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

// Resolve all animated properties for a layer at a given time
function resolveLayerValues(layer: Layer, time: number): Record<string, unknown> {
  const values: Record<string, unknown> = { ...layer.properties };

  if (layer.animation) {
    values[layer.animation.property] = interpolate(layer.animation.keyframes, time);
  }

  return values;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  renderFrame(composition: CompositionData, frameNumber: number): void {
    const time = frameNumber / composition.fps;

    this.canvas.width = composition.width;
    this.canvas.height = composition.height;

    // Clear background
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, composition.width, composition.height);

    // Draw each layer in order
    for (const layer of composition.layers) {
      const startTime = layer.startTime ?? 0;
      const layerDuration = layer.layerDuration ?? (composition.duration - startTime);
      if (time < startTime || time > startTime + layerDuration) continue;
      const localTime = time - startTime;
      this.drawLayer(layer, localTime);
    }
  }

  private drawLayer(layer: Layer, time: number): void {
    const values = resolveLayerValues(layer, time);
    const opacity = typeof values.opacity === 'number' ? values.opacity : 1;

    this.ctx.save();
    this.ctx.globalAlpha = Math.max(0, Math.min(1, opacity));

    switch (layer.type) {
      case 'text':
        this.drawText(layer, values);
        break;
      case 'shape':
        this.drawShape(layer, values);
        break;
      case 'image':
        // Image rendering requires async — handled separately
        break;
    }

    this.ctx.restore();
  }

  private drawText(layer: Layer, values: Record<string, unknown>): void {
    const fontSize = (values.fontSize as number) ?? 48;
    const color = (values.color as string) ?? '#ffffff';
    const text = (values.text as string) ?? '';
    const fontFamily = (values.fontFamily as string) ?? 'Inter, system-ui, sans-serif';
    const align = (values.align as CanvasTextAlign) ?? 'left';
    const fontWeight = (values.fontWeight as string) ?? '600';

    const offsetX = (values.offsetX as number) ?? 0;
    const offsetY = (values.offsetY as number) ?? 0;

    // Center within layer bounds if align = center
    let x = layer.position.x + offsetX;
    const y = layer.position.y + offsetY;

    if (align === 'center') {
      x = layer.position.x + layer.size.width / 2 + offsetX;
    } else if (align === 'right') {
      x = layer.position.x + layer.size.width + offsetX;
    }

    this.ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    this.ctx.fillStyle = color;
    this.ctx.textBaseline = 'middle';
    this.ctx.textAlign = align;

    // Subtle text shadow for readability
    this.ctx.shadowColor = 'rgba(0,0,0,0.5)';
    this.ctx.shadowBlur = 8;
    this.ctx.shadowOffsetX = 2;
    this.ctx.shadowOffsetY = 2;

    this.ctx.fillText(text, x, y + layer.size.height / 2);

    // Reset shadow
    this.ctx.shadowColor = 'transparent';
    this.ctx.shadowBlur = 0;
    this.ctx.shadowOffsetX = 0;
    this.ctx.shadowOffsetY = 0;
  }

  private drawShape(layer: Layer, values: Record<string, unknown>): void {
    const color = (values.color as string) ?? '#ffffff';
    const shape = (values.shape as string) ?? 'rect';
    const w = layer.size.width;
    const h = layer.size.height;
    const x = layer.position.x + ((values.offsetX as number) ?? 0);
    const y = layer.position.y + ((values.offsetY as number) ?? 0);

    this.ctx.fillStyle = color;

    if (shape === 'circle') {
      this.ctx.beginPath();
      this.ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      this.ctx.fill();
    } else {
      this.ctx.fillRect(x, y, w, h);
    }
  }
}

// ── Playback ──────────────────────────────────────────────────────────────────

export class PlaybackController {
  private renderer: CanvasRenderer;
  private composition: CompositionData;
  private frameNumber = 0;
  private rafId: number | null = null;
  private lastTimestamp: number | null = null;
  private frameAccumulator = 0;

  onFrameChange?: (frame: number) => void;
  onEnd?: () => void;

  constructor(renderer: CanvasRenderer, composition: CompositionData) {
    this.renderer = renderer;
    this.composition = composition;
  }

  get totalFrames(): number {
    return Math.floor(this.composition.duration * this.composition.fps);
  }

  get currentFrame(): number {
    return this.frameNumber;
  }

  seekToFrame(frame: number): void {
    this.frameNumber = Math.max(0, Math.min(frame, this.totalFrames - 1));
    this.renderer.renderFrame(this.composition, this.frameNumber);
    this.onFrameChange?.(this.frameNumber);
  }

  play(): void {
    if (this.rafId !== null) return;
    this.lastTimestamp = null;
    this.frameAccumulator = 0;
    this.tick();
  }

  pause(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastTimestamp = null;
  }

  stop(): void {
    this.pause();
    this.seekToFrame(0);
  }

  private tick = (timestamp?: number): void => {
    if (timestamp === undefined) {
      this.rafId = requestAnimationFrame(this.tick);
      return;
    }

    if (this.lastTimestamp !== null) {
      const delta = timestamp - this.lastTimestamp;
      this.frameAccumulator += (delta / 1000) * this.composition.fps;

      while (this.frameAccumulator >= 1) {
        this.frameNumber++;
        this.frameAccumulator -= 1;

        if (this.frameNumber >= this.totalFrames) {
          this.frameNumber = 0;
          this.onEnd?.();
        }
      }
    }

    this.lastTimestamp = timestamp;
    this.renderer.renderFrame(this.composition, this.frameNumber);
    this.onFrameChange?.(this.frameNumber);

    this.rafId = requestAnimationFrame(this.tick);
  };
}
