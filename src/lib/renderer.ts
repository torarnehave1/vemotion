import type { CompositionData, Layer, Keyframe, MotionScene } from './api';

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
  for (const anim of layer.animations ?? []) {
    values[anim.property] = interpolate(anim.keyframes, time);
  }

  const motionScenes = Array.isArray(values.motionScenes) ? values.motionScenes as MotionScene[] : [];
  if (motionScenes.length > 0) {
    const currentScene = motionScenes.find((scene) => time >= scene.start && time <= scene.end);
    if (currentScene) {
      const context = {
        t: time - currentScene.start,
        p: currentScene.end > currentScene.start ? (time - currentScene.start) / (currentScene.end - currentScene.start) : 0,
        start: currentScene.start,
        end: currentScene.end,
        duration: Math.max(0, currentScene.end - currentScene.start),
        x0: layer.position.x,
        y0: layer.position.y,
        w: layer.size.width,
        h: layer.size.height,
      };
      const sceneX = evaluateFormula(currentScene.xFormula, context);
      const sceneY = evaluateFormula(currentScene.yFormula, context);
      if (sceneX !== null) values.offsetX = sceneX - layer.position.x;
      if (sceneY !== null) values.offsetY = sceneY - layer.position.y;
    }
  }

  return values;
}

function evaluateFormula(
  formula: string | undefined,
  context: { t: number; p: number; start: number; end: number; duration: number; x0: number; y0: number; w: number; h: number }
): number | null {
  if (!formula || !formula.trim()) return null;
  const safe = formula.trim();
  if (!/^[0-9+\-*/%().,\s_a-zA-Z]+$/.test(safe)) return null;

  try {
    const fn = new Function(
      't', 'p', 'start', 'end', 'duration', 'x0', 'y0', 'w', 'h',
      'sin', 'cos', 'tan', 'abs', 'min', 'max', 'pow', 'sqrt', 'pi',
      `"use strict"; return (${safe});`
    ) as (...args: unknown[]) => number;
    const result = fn(
      context.t, context.p, context.start, context.end, context.duration, context.x0, context.y0, context.w, context.h,
      Math.sin, Math.cos, Math.tan, Math.abs, Math.min, Math.max, Math.pow, Math.sqrt, Math.PI
    );
    return Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private compositionFont = 'Inter, system-ui, sans-serif';
  private imageCache = new Map<string, HTMLImageElement>();

  onImageLoad?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  async preloadImages(composition: CompositionData): Promise<void> {
    const urls = composition.layers
      .filter(l => l.type === 'image')
      .map(l => l.properties.src as string)
      .filter(Boolean);

    await Promise.all(urls.map(src => this.loadImageAsync(src)));
  }

  private loadImageAsync(src: string): Promise<void> {
    if (this.imageCache.get(src)?.complete) return Promise.resolve();
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { this.imageCache.set(src, img); resolve(); };
      img.onerror = () => resolve();
      img.src = src;
    });
  }

  renderFrame(composition: CompositionData, frameNumber: number): void {
    const time = frameNumber / composition.fps;

    this.compositionFont = composition.fontFamily
      ? `${composition.fontFamily}, system-ui, sans-serif`
      : 'Inter, system-ui, sans-serif';

    this.canvas.width = composition.width;
    this.canvas.height = composition.height;

    // Clear background
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, composition.width, composition.height);

    // Draw each layer in order
    for (const layer of composition.layers) {
      if (layer.visible === false) continue;
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
    const scale   = typeof values.scale   === 'number' ? values.scale   : 1;

    this.ctx.save();
    this.ctx.globalAlpha = Math.max(0, Math.min(1, opacity));

    if (scale !== 1) {
      const cx = layer.position.x + layer.size.width  / 2;
      const cy = layer.position.y + layer.size.height / 2;
      this.ctx.translate(cx, cy);
      this.ctx.scale(scale, scale);
      this.ctx.translate(-cx, -cy);
    }

    switch (layer.type) {
      case 'text':
        this.drawText(layer, values);
        break;
      case 'shape':
        this.drawShape(layer, values);
        break;
      case 'math-shape':
        this.drawMathShape(layer, values);
        break;
      case 'image':
        this.drawImage(layer, values);
        break;
      case 'kg-shape':
        this.drawKgShape(layer, values);
        break;
      case 'card':
        this.drawCard(layer, values);
        break;
    }

    this.ctx.restore();
  }

  private drawText(layer: Layer, values: Record<string, unknown>): void {
    const fontSize = (values.fontSize as number) ?? 48;
    const color = (values.color as string) ?? '#ffffff';
    const text = (values.text as string) ?? '';
    const fontFamily = (values.fontFamily as string) ?? this.compositionFont;
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
    const borderRadius = (values.borderRadius as number) ?? 0;

    this.ctx.fillStyle = color;

    if (shape === 'circle') {
      this.ctx.beginPath();
      this.ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      this.ctx.fill();
    } else if (borderRadius > 0) {
      this.roundedRect(x, y, w, h, borderRadius);
      this.ctx.fill();
    } else {
      this.ctx.fillRect(x, y, w, h);
    }
  }

  private drawMathShape(layer: Layer, values: Record<string, unknown>): void {
    const kind = (values.mathKind as string) ?? 'parametric';
    const x = layer.position.x + ((values.offsetX as number) ?? 0);
    const y = layer.position.y + ((values.offsetY as number) ?? 0);
    const w = layer.size.width;
    const h = layer.size.height;
    const stroke = (values.stroke as string) ?? (values.color as string) ?? '#38bdf8';
    const strokeWidth = (values.strokeWidth as number) ?? 3;
    const fill = typeof values.fill === 'string' ? values.fill : null;
    const samples = Math.max(12, Math.min(720, Number(values.samples) || 180));
    const tStart = Number(values.tStart) || 0;
    const tEnd = Number(values.tEnd) || Math.PI * 2;
    const xFormula = typeof values.xFormula === 'string' ? values.xFormula : '';
    const yFormula = typeof values.yFormula === 'string' ? values.yFormula : '';
    const closePath = values.closePath !== false;
    const drawProgress = Math.max(0, Math.min(1, Number(values.drawProgress) || 1));

    if (kind !== 'parametric' || !xFormula || !yFormula) return;

    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= samples; i += 1) {
      const p = i / samples;
      const t = tStart + (tEnd - tStart) * p;
      const context = { t, p, start: tStart, end: tEnd, duration: tEnd - tStart, x0: x, y0: y, w, h };
      const px = evaluateFormula(xFormula, context);
      const py = evaluateFormula(yFormula, context);
      if (px === null || py === null) continue;
      points.push({ x: px, y: py });
    }

    if (points.length < 2) return;

    const visiblePointCount = Math.max(
      2,
      Math.min(points.length, Math.round(1 + (points.length - 1) * drawProgress))
    );
    const visiblePoints = points.slice(0, visiblePointCount);
    if (visiblePoints.length < 2) return;

    this.ctx.beginPath();
    this.ctx.moveTo(visiblePoints[0].x, visiblePoints[0].y);
    for (let i = 1; i < visiblePoints.length; i += 1) {
      this.ctx.lineTo(visiblePoints[i].x, visiblePoints[i].y);
    }
    if (closePath && drawProgress >= 0.999) {
      this.ctx.closePath();
    }

    if (fill && closePath && drawProgress >= 0.999) {
      this.ctx.fillStyle = fill;
      this.ctx.fill();
    }

    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = strokeWidth;
    this.ctx.stroke();
  }

  // ── Rounded rectangle helper ──────────────────────────────────────────────
  private roundedRect(x: number, y: number, w: number, h: number, r: number): void {
    const radius = Math.min(r, w / 2, h / 2);
    this.ctx.beginPath();
    this.ctx.moveTo(x + radius, y);
    this.ctx.lineTo(x + w - radius, y);
    this.ctx.arcTo(x + w, y, x + w, y + radius, radius);
    this.ctx.lineTo(x + w, y + h - radius);
    this.ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
    this.ctx.lineTo(x + radius, y + h);
    this.ctx.arcTo(x, y + h, x, y + h - radius, radius);
    this.ctx.lineTo(x, y + radius);
    this.ctx.arcTo(x, y, x + radius, y, radius);
    this.ctx.closePath();
  }

  // ── Card layer ────────────────────────────────────────────────────────────
  private drawCard(layer: Layer, values: Record<string, unknown>): void {
    const x = layer.position.x + ((values.offsetX as number) ?? 0);
    const y = layer.position.y + ((values.offsetY as number) ?? 0);
    const w = layer.size.width;
    const h = layer.size.height;

    const bg            = (values.backgroundColor as string) ?? '#1e293b';
    const borderRadius  = (values.borderRadius as number) ?? 12;
    const padding       = (values.padding as number) ?? 24;

    const title         = (values.title as string) ?? 'Title';
    const titleSize     = (values.titleFontSize as number) ?? 32;
    const titleColor    = (values.titleColor as string) ?? '#ffffff';
    const titleWeight   = (values.titleFontWeight as string) ?? '700';
    const titleFamily   = (values.fontFamily as string) ?? this.compositionFont;

    const body          = (values.body as string) ?? '';
    const bodySize      = (values.bodyFontSize as number) ?? 22;
    const bodyColor     = (values.bodyColor as string) ?? '#cbd5e1';
    const bodyFamily    = titleFamily;
    const gap           = (values.gap as number) ?? 12;
    const lineHeightMul = 1.25;

    // ── Background ───────────────────────────────────────────────────────────
    this.ctx.fillStyle = bg;
    this.roundedRect(x, y, w, h, borderRadius);
    this.ctx.fill();

    // Clip content to card bounds
    this.ctx.save();
    this.roundedRect(x, y, w, h, borderRadius);
    this.ctx.clip();

    const contentX = x + padding;
    const contentW = w - padding * 2;
    let cursorY = y + padding;

    // ── Title ────────────────────────────────────────────────────────────────
    this.ctx.font = `${titleWeight} ${titleSize}px ${titleFamily}`;
    this.ctx.fillStyle = titleColor;
    this.ctx.textBaseline = 'top';
    this.ctx.textAlign = 'left';

    const titleLines = this.wrapWords(title, contentW);
    const titleLineH = titleSize * lineHeightMul;
    for (const line of titleLines) {
      if (cursorY + titleLineH > y + h - padding) break;
      this.ctx.fillText(line, contentX, cursorY);
      cursorY += titleLineH;
    }

    // ── Body ─────────────────────────────────────────────────────────────────
    if (body) {
      cursorY += gap;
      this.ctx.font = `400 ${bodySize}px ${bodyFamily}`;
      this.ctx.fillStyle = bodyColor;
      const bodyLineH = bodySize * lineHeightMul;
      const bodyLines = this.wrapWords(body, contentW);
      for (const line of bodyLines) {
        if (cursorY + bodyLineH > y + h - padding) break;
        this.ctx.fillText(line, contentX, cursorY);
        cursorY += bodyLineH;
      }
    }

    this.ctx.restore();
  }

  private drawImage(layer: Layer, values: Record<string, unknown>): void {
    const src = (values.src as string) ?? '';
    if (!src) return;

    const x = layer.position.x + ((values.offsetX as number) ?? 0);
    const y = layer.position.y + ((values.offsetY as number) ?? 0);
    const w = layer.size.width;
    const h = layer.size.height;
    const fit = (values.fit as string) ?? 'cover';

    let img = this.imageCache.get(src);

    if (!img) {
      // Start loading — will appear on next frame once cached
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.imageCache.set(src, img!);
        this.onImageLoad?.();
      };
      img.onerror = () => { /* keep placeholder */ };
      img.src = src;
      this.imageCache.set(src, img);
      return;
    }

    if (!img.complete || img.naturalWidth === 0) return;

    if (fit === 'fill') {
      this.ctx.drawImage(img, x, y, w, h);
    } else if (fit === 'contain') {
      const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      this.ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else {
      // cover (default) — crop to fill
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const sw = w / scale;
      const sh = h / scale;
      const sx = (img.naturalWidth - sw) / 2;
      const sy = (img.naturalHeight - sh) / 2;
      this.ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    }
  }

  // Word-wrap helper — returns array of lines that fit within maxWidth
  private wrapWords(text: string, maxWidth: number): string[] {
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
    return lines;
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
    void this.renderer.renderFrame(this.composition, this.frameNumber);
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
    void this.renderer.renderFrame(this.composition, this.frameNumber);
    this.onFrameChange?.(this.frameNumber);

    this.rafId = requestAnimationFrame(this.tick);
  };
}
