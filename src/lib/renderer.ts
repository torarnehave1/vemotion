import type { Animation, CompositionData, Layer, Keyframe, MotionScene } from './api';

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

  // Skip non-layer animations (char-stagger, mask-wipe) here — they're applied
  // per-glyph or via clip in drawLayer/drawText, not as layer-property mutation.
  // Animations with no `kind` default to 'layer' for back-compat.
  if (layer.animation && (layer.animation.kind ?? 'layer') === 'layer' && layer.animation.property) {
    values[layer.animation.property] = interpolate(layer.animation.keyframes, time);
  }
  for (const anim of layer.animations ?? []) {
    if ((anim.kind ?? 'layer') !== 'layer') continue;
    if (!anim.property) continue;
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

/**
 * If the layer carries a 'mask-wipe' animation, apply an animated clip path
 * to the current context. The clip stays in canvas coords — call this before
 * any layer-scale transform so the geometry isn't warped.
 *
 * Direction semantics (all use a 0..1 keyframe progress):
 *   ltr    — rectangle grows from the left edge of the layer rightward
 *   rtl    — rectangle grows from the right edge of the layer leftward
 *   ttb    — rectangle grows from the top edge of the layer downward
 *   btt    — rectangle grows from the bottom edge of the layer upward
 *   radial — circle grows from layer centre to enclose the corners (iris reveal)
 *
 * progress = 0 → nothing rendered; progress = 1 → the full layer rect is visible.
 */
function applyMaskWipeClip(ctx: CanvasRenderingContext2D, layer: Layer, time: number): void {
  // Find the first mask-wipe animation on the layer (single or in animations[]).
  let anim: Animation | undefined;
  if (layer.animation?.kind === 'mask-wipe') {
    anim = layer.animation;
  }
  if (!anim) {
    anim = layer.animations?.find(a => a.kind === 'mask-wipe');
  }
  if (!anim) return;

  const raw = interpolate(anim.keyframes, time);
  const progress = Math.max(0, Math.min(1, raw));
  const direction = anim.direction ?? 'ltr';

  const lx = layer.position.x;
  const ly = layer.position.y;
  const lw = layer.size.width;
  const lh = layer.size.height;

  ctx.beginPath();
  switch (direction) {
    case 'ltr':
      ctx.rect(lx, ly, lw * progress, lh);
      break;
    case 'rtl':
      ctx.rect(lx + lw * (1 - progress), ly, lw * progress, lh);
      break;
    case 'ttb':
      ctx.rect(lx, ly, lw, lh * progress);
      break;
    case 'btt':
      ctx.rect(lx, ly + lh * (1 - progress), lw, lh * progress);
      break;
    case 'radial': {
      const cx = lx + lw / 2;
      const cy = ly + lh / 2;
      // Hypot to the corner — at progress = 1 the circle fully encloses the rect.
      const maxR = Math.sqrt(lw * lw + lh * lh) / 2;
      ctx.arc(cx, cy, maxR * progress, 0, Math.PI * 2);
      break;
    }
  }
  ctx.clip();
}

/**
 * Compute the visual bounding rect of a layer at a given local time, including
 * offsetX/Y and scale (around centre). Returns null if the layer has zero or
 * negative size. Used by both the selection overlay and the hit-test.
 */
function computeLayerBounds(layer: Layer, localTime: number): { x: number; y: number; w: number; h: number } | null {
  const values = resolveLayerValues(layer, localTime);
  const offsetX = typeof values.offsetX === 'number' ? values.offsetX : 0;
  const offsetY = typeof values.offsetY === 'number' ? values.offsetY : 0;
  const scale = typeof values.scale === 'number' ? values.scale : 1;
  const baseW = layer.size.width;
  const baseH = layer.size.height;
  if (!(baseW > 0) || !(baseH > 0)) return null;
  const cx = layer.position.x + baseW / 2;
  const cy = layer.position.y + baseH / 2;
  const w = baseW * scale;
  const h = baseH * scale;
  return {
    x: cx - w / 2 + offsetX,
    y: cy - h / 2 + offsetY,
    w,
    h,
  };
}

/**
 * Draw an image into a target rectangle with one of three fit modes.
 * Shared between the image layer renderer and the text image-fill path.
 *
 *   fill     — stretch to (w, h), aspect ignored
 *   contain  — letterbox: image fits entirely, centred, extra space transparent
 *   cover    — crop to fill: image fills (w, h), excess cropped (default)
 */
function drawImageFitted(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: string,
): void {
  if (fit === 'fill') {
    ctx.drawImage(img, x, y, w, h);
  } else if (fit === 'contain') {
    const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  } else {
    // cover (default) — crop to fill
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (img.naturalWidth - sw) / 2;
    const sy = (img.naturalHeight - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private compositionFont = 'Inter, system-ui, sans-serif';
  private imageCache = new Map<string, HTMLImageElement>();

  /**
   * Id of the layer currently selected in the editor. When non-null,
   * renderFrame draws a selection overlay (dashed rectangle + corner dots)
   * around that layer at the end of the frame. The exporter never sets
   * this, so MP4 output never includes the overlay.
   */
  selectedLayerId: string | null = null;

  onImageLoad?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  async preloadImages(composition: CompositionData): Promise<void> {
    const urls: string[] = [];
    for (const l of composition.layers) {
      // Image layers — straightforward `src`.
      if (l.type === 'image' && typeof l.properties.src === 'string') {
        urls.push(l.properties.src);
      }
      // Text layers using `fillMode: 'image'` — letter-masked image source.
      if (l.type === 'text'
        && l.properties.fillMode === 'image'
        && typeof l.properties.fillSource === 'string') {
        urls.push(l.properties.fillSource);
      }
    }
    await Promise.all(urls.filter(Boolean).map(src => this.loadImageAsync(src)));
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

    // Editor-only selection overlay. Drawn last so it sits above content.
    if (this.selectedLayerId) {
      this.drawSelectionOverlay(composition, time);
    }
  }

  /**
   * Hit-test a click against the composition at a given time. Returns the
   * topmost (last-drawn) layer's id whose post-animation bounding rect
   * contains the point, or null.
   *
   * Coordinates are in canvas pixel space (not screen space) — callers
   * convert via `getBoundingClientRect()` + the canvas width/height ratio.
   *
   * Bounding rect for v1 = layer.position + size scaled around the layer
   * centre + offsetX/Y. No path-accurate hit test on kg-shape / math-shape
   * geometry yet — those use the bounding rect.
   */
  hitTest(canvasX: number, canvasY: number, composition: CompositionData, time: number): string | null {
    for (let i = composition.layers.length - 1; i >= 0; i--) {
      const layer = composition.layers[i];
      if (layer.visible === false) continue;
      const startTime = layer.startTime ?? 0;
      const layerDuration = layer.layerDuration ?? (composition.duration - startTime);
      if (time < startTime || time > startTime + layerDuration) continue;
      const localTime = time - startTime;
      const bounds = computeLayerBounds(layer, localTime);
      if (bounds === null) continue;
      if (canvasX >= bounds.x && canvasX <= bounds.x + bounds.w
        && canvasY >= bounds.y && canvasY <= bounds.y + bounds.h) {
        return layer.id;
      }
    }
    return null;
  }

  private drawSelectionOverlay(composition: CompositionData, time: number): void {
    const layer = composition.layers.find(l => l.id === this.selectedLayerId);
    if (!layer || layer.visible === false) return;
    const startTime = layer.startTime ?? 0;
    const layerDuration = layer.layerDuration ?? (composition.duration - startTime);
    if (time < startTime || time > startTime + layerDuration) return;
    const localTime = time - startTime;
    const bounds = computeLayerBounds(layer, localTime);
    if (bounds === null) return;

    const { x, y, w, h } = bounds;
    this.ctx.save();
    // Dashed sky-blue outline.
    this.ctx.strokeStyle = '#38bdf8'; // sky-400
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([8, 4]);
    this.ctx.strokeRect(x, y, w, h);
    // Corner dots (filled).
    this.ctx.setLineDash([]);
    this.ctx.fillStyle = '#38bdf8';
    const dot = 8;
    const corners: Array<[number, number]> = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
    for (const [dx, dy] of corners) {
      this.ctx.fillRect(dx - dot / 2, dy - dot / 2, dot, dot);
    }
    this.ctx.restore();
  }

  private drawLayer(layer: Layer, time: number): void {
    const values = resolveLayerValues(layer, time);
    const opacity = typeof values.opacity === 'number' ? values.opacity : 1;
    const scale   = typeof values.scale   === 'number' ? values.scale   : 1;

    this.ctx.save();
    this.ctx.globalAlpha = Math.max(0, Math.min(1, opacity));

    // Mask-wipe: applied here, BEFORE the scale transform, so the clip rect
    // stays in unscaled canvas coordinates regardless of any layer scale anim.
    applyMaskWipeClip(this.ctx, layer, time);

    if (scale !== 1) {
      const cx = layer.position.x + layer.size.width  / 2;
      const cy = layer.position.y + layer.size.height / 2;
      this.ctx.translate(cx, cy);
      this.ctx.scale(scale, scale);
      this.ctx.translate(-cx, -cy);
    }

    switch (layer.type) {
      case 'text':
        this.drawText(layer, values, time);
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

  private drawText(layer: Layer, values: Record<string, unknown>, time: number): void {
    const fontSize = (values.fontSize as number) ?? 48;
    const color = (values.color as string) ?? '#ffffff';
    const fontFamily = (values.fontFamily as string) ?? this.compositionFont;
    const fontWeight = (values.fontWeight as string) ?? '600';

    const offsetX = (values.offsetX as number) ?? 0;
    const offsetY = (values.offsetY as number) ?? 0;
    const maxWidth = layer.size.width;
    const layerLeft = layer.position.x + offsetX;
    const layerTop  = layer.position.y + offsetY;

    const fontStr = `${fontWeight} ${fontSize}px ${fontFamily}`;

    const applyTextStyle = (ctx: CanvasRenderingContext2D, withShadow: boolean) => {
      ctx.font = fontStr;
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      if (withShadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
      } else {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }
    };

    const fillMode = values.fillMode as string | undefined;
    const fillSource = values.fillSource as string | undefined;

    // ── Image-fill (text-as-mask) path ──────────────────────────────────────
    // Letterforms become a window onto the source image. Renders text into an
    // offscreen canvas at origin (0,0), then uses `source-in` compositing to
    // keep only the image pixels that overlap the text. Finally drawImage's
    // the offscreen onto the main canvas at the layer position.
    if (fillMode === 'image' && fillSource) {
      const img = this.imageCache.get(fillSource);
      if (!img) {
        // Kick off load; this frame falls back to the solid path so the user
        // doesn't see an empty layer while the image fetches.
        void this.loadImageAsync(fillSource);
      } else if (img.complete && img.naturalWidth > 0) {
        const lw = layer.size.width;
        const lh = layer.size.height;
        const off = document.createElement('canvas');
        off.width = Math.max(1, Math.ceil(lw));
        off.height = Math.max(1, Math.ceil(lh));
        const offCtx = off.getContext('2d');
        if (offCtx) {
          // Render text onto offscreen at origin. Shadows are skipped — they
          // produce ghost fringes that survive `source-in` and look muddy.
          applyTextStyle(offCtx, false);
          this.renderTextGlyphs(offCtx, layer, values, time, 0, 0);
          // Keep only image pixels that overlap text.
          offCtx.globalCompositeOperation = 'source-in';
          const fit = (values.fillFit as string) ?? 'cover';
          drawImageFitted(offCtx, img, 0, 0, off.width, off.height, fit);
          // Composite onto main canvas at layer position. globalAlpha (from
          // drawLayer) and any mask-wipe clip both still apply here.
          this.ctx.drawImage(off, layerLeft, layerTop);
          return;
        }
      }
      // Else: image not ready — fall through to solid path for this frame.
    }

    // ── Solid path (existing behaviour) ─────────────────────────────────────
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(layerLeft, layerTop, maxWidth, layer.size.height);
    this.ctx.clip();
    applyTextStyle(this.ctx, true);
    this.renderTextGlyphs(this.ctx, layer, values, time, layerLeft, layerTop);
    // Reset shadow so subsequent layers' draw calls don't inherit it.
    this.ctx.shadowColor = 'transparent';
    this.ctx.shadowBlur = 0;
    this.ctx.shadowOffsetX = 0;
    this.ctx.shadowOffsetY = 0;
    this.ctx.restore();
  }

  /**
   * Render the wrapped + aligned + (optionally) char-staggered text glyphs
   * onto an arbitrary 2D context, anchored at (layerLeft, layerTop).
   *
   * Callers MUST have already set ctx.font, ctx.fillStyle (and any shadow
   * properties they want) on `ctx`. This helper handles only word-wrap,
   * vertical centring, alignment, and per-glyph stagger.
   */
  private renderTextGlyphs(
    ctx: CanvasRenderingContext2D,
    layer: Layer,
    values: Record<string, unknown>,
    time: number,
    layerLeft: number,
    layerTop: number,
  ): void {
    const fontSize = (values.fontSize as number) ?? 48;
    const text = (values.text as string) ?? '';
    const align = (values.align as CanvasTextAlign) ?? ((values.textAlign as CanvasTextAlign) ?? 'left');
    const lineHeightMultiplier = (values.lineHeight as number) ?? 1.25;
    const maxWidth = layer.size.width;
    const lineHeight = fontSize * lineHeightMultiplier;

    // ── Word-wrap ───────────────────────────────────────────────────────────
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);

    const totalTextHeight = lines.length * lineHeight;
    const startY = layerTop + (layer.size.height - totalTextHeight) / 2 + lineHeight / 2;

    // Collect any char-stagger animations targeting this layer.
    const charAnims: Animation[] = [];
    if (layer.animation && layer.animation.kind === 'char-stagger') {
      charAnims.push(layer.animation);
    }
    for (const a of layer.animations ?? []) {
      if (a.kind === 'char-stagger') charAnims.push(a);
    }

    if (charAnims.length === 0) {
      // Fast path: line-by-line fillText with native alignment.
      let x = layerLeft;
      if (align === 'center') x = layerLeft + maxWidth / 2;
      else if (align === 'right') x = layerLeft + maxWidth;
      ctx.textAlign = align;
      lines.forEach((line, i) => {
        ctx.fillText(line, x, startY + i * lineHeight);
      });
      return;
    }

    // Per-glyph path (char-stagger).
    ctx.textAlign = 'left';
    const baseAlpha = ctx.globalAlpha;
    let globalCharIdx = 0;
    lines.forEach((line, lineIdx) => {
      const lineY = startY + lineIdx * lineHeight;
      const lineWidth = ctx.measureText(line).width;
      let cursorX = layerLeft;
      if (align === 'center') cursorX = layerLeft + (maxWidth - lineWidth) / 2;
      else if (align === 'right') cursorX = layerLeft + (maxWidth - lineWidth);

      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const charWidth = ctx.measureText(ch).width;

        let charOpacity = 1;
        let charOffsetX = 0;
        let charOffsetY = 0;
        let charScale = 1;
        for (const anim of charAnims) {
          const delay = globalCharIdx * (anim.stagger ?? 0);
          const charTime = time - delay;
          const val = interpolate(anim.keyframes, charTime);
          switch (anim.property) {
            case 'opacity':  charOpacity = Math.max(0, Math.min(1, val)); break;
            case 'offsetX':  charOffsetX = val; break;
            case 'offsetY':  charOffsetY = val; break;
            case 'scale':    charScale   = val; break;
          }
        }

        ctx.save();
        ctx.globalAlpha = baseAlpha * charOpacity;
        if (charScale !== 1) {
          const cx = cursorX + charWidth / 2;
          const cy = lineY;
          ctx.translate(cx, cy);
          ctx.scale(charScale, charScale);
          ctx.translate(-cx, -cy);
        }
        ctx.fillText(ch, cursorX + charOffsetX, lineY + charOffsetY);
        ctx.restore();

        cursorX += charWidth;
        globalCharIdx++;
      }
    });
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
    // Use nullish coalescing, not `||` — a drawProgress of exactly 0 is the
    // valid "nothing yet drawn" state at frame 0 of a drawProgress animation,
    // and `Number(0) || 1` would silently flip it to 1 (the full curve flashes
    // for one frame, vanishes, then draws — the classic symptom).
    const drawProgress = Math.max(0, Math.min(1, Number(values.drawProgress ?? 1)));

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

    drawImageFitted(this.ctx, img, x, y, w, h, fit);
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
  // Public so VideoPreview can swap in a new composition without recreating
  // the controller (and without resetting frameNumber to 0). All reads happen
  // on each tick / seek so the swap takes effect immediately.
  composition: CompositionData;
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
