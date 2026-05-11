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

// Resolve all animated properties for a layer at a given time.
// Also normalises property aliases produced by external generators (e.g. Codex):
//   fill  → color   (shape fill colour)
//   rectangle → rect, ellipse → circle (shape type names)
function resolveLayerValues(layer: Layer, time: number): Record<string, unknown> {
  const values: Record<string, unknown> = { ...layer.properties };

  // Alias: fill → color
  if (values.fill !== undefined && values.color === undefined) {
    values.color = values.fill;
  }
  // Alias: shape name normalisation
  if (values.shape === 'rectangle') values.shape = 'rect';
  if (values.shape === 'ellipse')   values.shape = 'circle';

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
      case 'kg-shape':
        this.drawKgShape(layer, values);
        break;
    }

    this.ctx.restore();
  }

  private drawText(layer: Layer, values: Record<string, unknown>): void {
    const fontSize = (values.fontSize as number) ?? 48;
    const color = (values.color as string) ?? '#ffffff';
    const text = (values.text as string) ?? '';
    const fontFamily = (values.fontFamily as string) ?? 'Inter, system-ui, sans-serif';
    const align = (values.align as CanvasTextAlign) ?? ((values.textAlign as CanvasTextAlign) ?? 'left');
    const fontWeight = (values.fontWeight as string) ?? '600';
    const lineHeightMultiplier = (values.lineHeight as number) ?? 1.25;

    const offsetX = (values.offsetX as number) ?? 0;
    const offsetY = (values.offsetY as number) ?? 0;

    const maxWidth = layer.size.width;
    const layerLeft = layer.position.x + offsetX;
    const layerTop  = layer.position.y + offsetY;

    this.ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;

    // ── Word-wrap ────────────────────────────────────────────────────────────
    const lineHeight = fontSize * lineHeightMultiplier;
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (this.ctx.measureText(test).width <= maxWidth) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);

    const totalTextHeight = lines.length * lineHeight;

    // Clip to layer bounds so nothing bleeds outside
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(layerLeft, layerTop, maxWidth, layer.size.height);
    this.ctx.clip();

    // Anchor x depending on alignment
    let x = layerLeft;
    if (align === 'center') x = layerLeft + maxWidth / 2;
    else if (align === 'right') x = layerLeft + maxWidth;

    // Vertically centre the text block inside the layer
    const startY = layerTop + (layer.size.height - totalTextHeight) / 2 + lineHeight / 2;

    this.ctx.fillStyle = color;
    this.ctx.textBaseline = 'middle';
    this.ctx.textAlign = align;
    this.ctx.shadowColor = 'rgba(0,0,0,0.5)';
    this.ctx.shadowBlur = 8;
    this.ctx.shadowOffsetX = 2;
    this.ctx.shadowOffsetY = 2;

    lines.forEach((line, i) => {
      this.ctx.fillText(line, x, startY + i * lineHeight);
    });

    this.ctx.shadowColor = 'transparent';
    this.ctx.shadowBlur = 0;
    this.ctx.shadowOffsetX = 0;
    this.ctx.shadowOffsetY = 0;
    this.ctx.restore();
  }

  private drawKgShape(layer: Layer, values: Record<string, unknown>): void {
    const svgPath = (values.svgPath as string) ?? '';
    const viewBox = (values.viewBox as string) ?? '0 0 24 24';
    const color = (values.color as string) ?? '#ffffff';
    const strokeColor = (values.strokeColor as string) ?? '';
    const strokeWidth = (values.strokeWidth as number) ?? 0;
    const filled = (values.filled as boolean) ?? true;

    if (!svgPath) return;

    const [, , vbW, vbH] = viewBox.split(' ').map(Number);
    const scaleX = layer.size.width / vbW;
    const scaleY = layer.size.height / vbH;
    const offsetX = layer.position.x + ((values.offsetX as number) ?? 0);
    const offsetY = layer.position.y + ((values.offsetY as number) ?? 0);

    this.ctx.save();
    this.ctx.translate(offsetX, offsetY);
    this.ctx.scale(scaleX, scaleY);

    const path = new Path2D(svgPath);

    if (filled) {
      this.ctx.fillStyle = color;
      this.ctx.fill(path);
    }
    if (strokeColor && strokeWidth > 0) {
      this.ctx.strokeStyle = strokeColor;
      this.ctx.lineWidth = strokeWidth;
      this.ctx.stroke(path);
    } else if (!filled) {
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = strokeWidth || 2;
      this.ctx.stroke(path);
    }

    this.ctx.restore();
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
