import type { Animation, CompositionData, Layer, Keyframe, MotionScene, PathAnchor, PathMask, ImagePatch } from './api';
import { samplePath } from './pathSampling';
import { sampleAudioTrack } from './audioAnalysis';
import { renderKnittingChart, type KnittingChart } from './knitting';
import { layoutTelemetryTrack, DEFAULT_TELEMETRY_COLORS, type TelemetryTrackProps, type TelemetrySegType } from './telemetryTrack';

// ── Interpolation ─────────────────────────────────────────────────────────────

export type EasingMode = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

/**
 * Interpolate a keyframe sequence at the given local time using the chosen
 * easing curve between adjacent keyframes. Boundary clamp: any time at or
 * before the first keyframe returns the first value; any time at or after
 * the last keyframe returns the last. Default easing is 'easeInOut' for
 * back-compat — animations authored before easing was honoured continue to
 * render identically.
 */
export function interpolate(
  keyframes: Keyframe[],
  time: number,
  easing: EasingMode = 'easeInOut',
): number {
  if (!Array.isArray(keyframes) || keyframes.length === 0) return 0;
  if (keyframes.length === 1) return keyframes[0].value as number;

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  if (time <= sorted[0].time) return sorted[0].value as number;
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value as number;

  const after = sorted.find(k => k.time > time)!;
  const before = sorted[sorted.indexOf(after) - 1];

  const progress = (time - before.time) / (after.time - before.time);
  const eased = applyEasing(progress, easing);

  return (before.value as number) + ((after.value as number) - (before.value as number)) * eased;
}

/**
 * All easing functions take normalised input `t` in [0, 1] and return a
 * value in [0, 1] (slight overshoot is mathematically possible at the
 * extremes for some curves but quadratic ease-in/out stay bounded). Curves
 * chosen for predictability + cheap computation, not for fancy motion.
 */
function applyEasing(t: number, mode: EasingMode): number {
  switch (mode) {
    case 'linear':    return t;
    case 'easeIn':    return t * t;
    case 'easeOut':   return 1 - (1 - t) * (1 - t);
    case 'easeInOut':
    default:          return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }
}

// Resolve all animated properties for a layer at a given time.
// Also normalises property aliases produced by external generators (e.g. Codex):
//   fill  → color   (shape fill colour)
//   rectangle → rect, ellipse → circle (shape type names)
function resolveLayerValues(layer: Layer, time: number, composition?: CompositionData): Record<string, unknown> {
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
    values[layer.animation.property] = interpolate(layer.animation.keyframes, time, layer.animation.easing);
  }
  for (const anim of layer.animations ?? []) {
    if ((anim.kind ?? 'layer') !== 'layer') continue;
    if (!anim.property) continue;
    values[anim.property] = interpolate(anim.keyframes, time, anim.easing);
  }

  // Audio amp lookup — sampled at ABSOLUTE composition time (layer-local
  // time + layer.startTime), so amp is consistent across every layer at
  // the same moment. Stashed on values with namespaced keys so drawMathShape
  // (which doesn't see composition directly) can read them back.
  const layerStartTime = layer.startTime ?? 0;
  const absoluteTime = time + layerStartTime;
  const ampSample = sampleAudioTrack(composition?.meta?.audioTrack, absoluteTime);
  values.__amp = ampSample.amp;
  values.__ampL = ampSample.ampL;
  values.__ampR = ampSample.ampR;

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
        amp: ampSample.amp,
        ampL: ampSample.ampL,
        ampR: ampSample.ampR,
        time,
      };
      const sceneX = evaluateFormula(currentScene.xFormula, context);
      const sceneY = evaluateFormula(currentScene.yFormula, context);
      if (sceneX !== null) values.offsetX = sceneX - layer.position.x;
      if (sceneY !== null) values.offsetY = sceneY - layer.position.y;
      // Optional formula-driven scale. Overrides any keyframe/static scale
      // for the duration of the scene window — same override convention as
      // x/y formulas.
      const sceneScale = evaluateFormula(currentScene.scaleFormula, context);
      if (sceneScale !== null) values.scale = sceneScale;
      // Path-follow: if pathLayerId is set on the scene, look up the path
      // layer in the composition, sample it at scene-local p, and set
      // offsetX/offsetY so the layer's CENTRE rides the path. Takes
      // precedence over xFormula/yFormula (it's the more specific intent).
      if (currentScene.pathLayerId && composition) {
        const pathLayer = composition.layers.find((l) => l.id === currentScene.pathLayerId);
        if (pathLayer && pathLayer.type === 'path') {
          const anchors = (pathLayer.properties as Record<string, unknown>).anchors as PathAnchor[] | undefined;
          const closed = ((pathLayer.properties as Record<string, unknown>).closed === true);
          if (Array.isArray(anchors) && anchors.length > 0) {
            const sampled = samplePath(anchors, context.p, closed);
            // The layer's CENTRE follows the path → top-left = centre - half size.
            const halfW = (layer.size.width  ?? 0) / 2;
            const halfH = (layer.size.height ?? 0) / 2;
            values.offsetX = (sampled.x - halfW) - layer.position.x;
            values.offsetY = (sampled.y - halfH) - layer.position.y;
          }
        }
      }
    }
  }

  return values;
}

function evaluateFormula(
  formula: string | undefined,
  context: {
    t: number; p: number; start: number; end: number; duration: number;
    x0: number; y0: number; w: number; h: number;
    amp: number; ampL: number; ampR: number;
    time: number;
  },
): number | null {
  if (!formula || !formula.trim()) return null;
  const safe = formula.trim();
  if (!/^[0-9+\-*/%().,\s_a-zA-Z]+$/.test(safe)) return null;

  try {
    const fn = new Function(
      't', 'p', 'start', 'end', 'duration', 'x0', 'y0', 'w', 'h',
      'amp', 'ampL', 'ampR', 'time',
      'sin', 'cos', 'tan', 'abs', 'min', 'max', 'pow', 'sqrt', 'pi',
      `"use strict"; return (${safe});`
    ) as (...args: unknown[]) => number;
    const result = fn(
      context.t, context.p, context.start, context.end, context.duration, context.x0, context.y0, context.w, context.h,
      context.amp, context.ampL, context.ampR, context.time,
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

  const raw = interpolate(anim.keyframes, time, anim.easing);
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
 * Sample a path's anchors into a flat polyline of canvas points. Bezier
 * segments (where either endpoint contributes a handle) are subdivided into
 * STEPS line segments so distance tests / bounds stay close to the curve.
 * Mirrors the segment logic in drawPath — keep the two in sync.
 */
function samplePathPoints(anchors: PathAnchor[], closed: boolean): Array<{ x: number; y: number }> {
  const STEPS = 16;
  const pts: Array<{ x: number; y: number }> = [{ x: anchors[0].x, y: anchors[0].y }];
  const seg = (a: PathAnchor, b: PathAnchor) => {
    if (a.out || b.in) {
      const c1x = a.out ? a.x + a.out.x : a.x;
      const c1y = a.out ? a.y + a.out.y : a.y;
      const c2x = b.in ? b.x + b.in.x : b.x;
      const c2y = b.in ? b.y + b.in.y : b.y;
      for (let s = 1; s <= STEPS; s += 1) {
        const t = s / STEPS;
        const mt = 1 - t;
        const x = mt * mt * mt * a.x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * b.x;
        const y = mt * mt * mt * a.y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * b.y;
        pts.push({ x, y });
      }
    } else {
      pts.push({ x: b.x, y: b.y });
    }
  };
  for (let i = 1; i < anchors.length; i += 1) seg(anchors[i - 1], anchors[i]);
  if (closed) seg(anchors[anchors.length - 1], anchors[0]);
  return pts;
}

/** Shortest distance from point (px,py) to the segment a→b. */
function distToSegment(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Hit-test a path layer by proximity to its actual stroke geometry, not its
 * declared (often full-canvas) bounding box. Returns true when the point is
 * within the stroke half-width + a small grab tolerance of any segment.
 */
function hitTestPath(layer: Layer, localTime: number, px: number, py: number, composition?: CompositionData): boolean {
  const values = resolveLayerValues(layer, localTime, composition);
  if (values.showInPreview === false) return false;
  const anchors = values.anchors as PathAnchor[] | undefined;
  if (!Array.isArray(anchors) || anchors.length < 2) return false;
  const strokeWidth = typeof values.strokeWidth === 'number' ? values.strokeWidth : 2;
  const closed = (values.closed as boolean) ?? false;
  const tol = Math.max(6, strokeWidth / 2 + 4);
  const pts = samplePathPoints(anchors, closed);
  for (let i = 1; i < pts.length; i += 1) {
    if (distToSegment(px, py, pts[i - 1], pts[i]) <= tol) return true;
  }
  return false;
}

/**
 * Compute the visual bounding rect of a layer at a given local time, including
 * offsetX/Y and scale (around centre). Returns null if the layer has zero or
 * negative size. Used by both the selection overlay and the hit-test.
 *
 * Path layers are a special case: drawPath ignores position/size and draws
 * from absolute anchor coordinates, so their declared size (usually the full
 * canvas) is meaningless for bounds. Compute the tight anchor-extent box
 * instead, padded by the stroke half-width.
 */
function computeLayerBounds(layer: Layer, localTime: number, composition?: CompositionData): { x: number; y: number; w: number; h: number } | null {
  if (layer.type === 'path') {
    const values = resolveLayerValues(layer, localTime, composition);
    const anchors = values.anchors as PathAnchor[] | undefined;
    if (!Array.isArray(anchors) || anchors.length < 2) return null;
    const closed = (values.closed as boolean) ?? false;
    const strokeWidth = typeof values.strokeWidth === 'number' ? values.strokeWidth : 2;
    const pts = samplePathPoints(anchors, closed);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = strokeWidth / 2 + 2;
    return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
  }
  const values = resolveLayerValues(layer, localTime, composition);
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

/** One of the 8 selection resize handles (Illustrator layout). */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/**
 * Canvas-space centre point of each of the 8 resize handles for a bounds rect
 * (4 corners + 4 edge midpoints). Shared by the selection overlay (draw) and
 * the hit-test so the drawn handle and its grab target never drift apart.
 */
function selectionHandlePoints(b: { x: number; y: number; w: number; h: number }): Record<ResizeHandle, [number, number]> {
  const { x, y, w, h } = b;
  const mx = x + w / 2;
  const my = y + h / 2;
  return {
    nw: [x, y],         n: [mx, y],       ne: [x + w, y],
    w:  [x, my],                          e:  [x + w, my],
    sw: [x, y + h],     s: [mx, y + h],   se: [x + w, y + h],
  };
}

/** Distance above the north-centre handle where the rotation circle is drawn. */
const ROTATION_HANDLE_OFFSET = 28;

/** Canvas-space centre of the rotation handle (above the top-centre of the bounds). */
function rotationHandlePoint(b: { x: number; y: number; w: number; h: number }): [number, number] {
  return [b.x + b.w / 2, b.y - ROTATION_HANDLE_OFFSET];
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
  img: HTMLImageElement | HTMLVideoElement,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: string,
): void {
  // Intrinsic source dimensions differ by element: images expose
  // naturalWidth/Height, videos expose videoWidth/Height.
  const iw = img instanceof HTMLVideoElement ? img.videoWidth : img.naturalWidth;
  const ih = img instanceof HTMLVideoElement ? img.videoHeight : img.naturalHeight;
  if (fit === 'fill') {
    ctx.drawImage(img, x, y, w, h);
  } else if (fit === 'contain') {
    const scale = Math.min(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  } else {
    // cover (default) — crop to fill
    const scale = Math.max(w / iw, h / ih);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (iw - sw) / 2;
    const sy = (ih - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private compositionFont = 'Inter, system-ui, sans-serif';
  private imageCache = new Map<string, HTMLImageElement>();
  // Video layers: one off-DOM <video> element per source URL. The element's
  // currentTime is seeked to the matching source time before each frame is
  // drawn (frame-accurate in export via seekVideos; best-effort in preview).
  private videoCache = new Map<string, HTMLVideoElement>();

  /**
   * Id of the layer currently selected in the editor. When non-null,
   * renderFrame draws a selection overlay (dashed rectangle + corner dots)
   * around that layer at the end of the frame. The exporter never sets
   * this, so MP4 output never includes the overlay.
   */
  selectedLayerId: string | null = null;

  /**
   * Smart-guide flags. When `vertical` is true, renderFrame draws a magenta
   * vertical line at `x = composition.width / 2`. When `horizontal` is true,
   * a magenta horizontal line at `y = composition.height / 2`. Both can be
   * on simultaneously when a dragged layer is centred on both axes. Set by
   * VideoPreview during edit-mode drags; cleared on mouseup. Exporter
   * never sets it, so MP4 output stays guide-free.
   */
  snapGuides: { vertical: boolean; horizontal: boolean } | null = null;

  /**
   * Editor-only toggle for persisted ruler guides (composition.meta.guides).
   * VideoPreview sets this true; the exporter never does, so guides stay out
   * of MP4 output. When true, renderFrame draws each guide as a cyan line.
   */
  showGuides = false;

  /** Editor-only mm grid overlay. Only drawn when composition.meta.scale is set. */
  showGrid = false;
  /** Editor-only mm ruler along top + left edges. Only drawn when composition.meta.scale is set. */
  showRuler = false;
  /** Real-world size of each grid square in mm (default 100 mm = 10 cm). */
  gridSizeMm = 100;

  /**
   * A guide being dragged out of a ruler but not yet committed. Drawn dashed
   * so it reads as a preview distinct from committed guides. Set by
   * VideoPreview during a ruler drag; cleared on drop.
   */
  draftGuide: { axis: 'x' | 'y'; position: number } | null = null;

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

  /**
   * Force every font the composition uses to be fetched before any frame is
   * drawn. Google Fonts ships each family as a lazy `@font-face` — the browser
   * only fetches it once something on the page actually uses it. The export
   * canvas is off-DOM and draws via `ctx.font`, which does NOT trigger that
   * fetch and silently falls back to a default face. For Latin that is merely a
   * wrong typeface; for Devanagari (Anek/Noto/Tiro) the fallback has no glyphs,
   * so the MP4/PNG exports as blank boxes even when the live preview is correct.
   *
   * `document.fonts.load(<shorthand>, <sampleText>)` explicitly requests the
   * matching face (the sample text spans Latin + Devanagari so Google's split
   * subsets both load), then `document.fonts.ready` waits for them all. Failures
   * resolve silently — a missing font just falls back, same posture as images.
   */
  async preloadFonts(composition: CompositionData): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return;
    const sample = 'Ag देवनागरी';
    const specs = new Set<string>();
    const add = (family?: unknown, weight?: unknown) => {
      if (typeof family !== 'string' || !family.trim()) return;
      const w = typeof weight === 'string' || typeof weight === 'number' ? weight : '400';
      specs.add(`${w} 48px ${family}`);
    };
    if (composition.fontFamily) add(composition.fontFamily, '400');
    for (const l of composition.layers) {
      if (l.type === 'text' || l.type === 'card') {
        const p = l.properties as Record<string, unknown>;
        add(p.fontFamily, p.fontWeight);
      }
    }
    await Promise.all(
      [...specs].map(spec =>
        document.fonts.load(spec, sample).catch(() => undefined)
      )
    );
    await document.fonts.ready;
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

  /**
   * Load every video layer's source into an off-DOM <video> element so frames
   * draw without a blank placeholder. Resolves once each video has data for
   * its first frame (readyState >= HAVE_CURRENT_DATA). Errors resolve silently
   * — a missing video just renders nothing, like a missing image.
   */
  async preloadVideos(composition: CompositionData): Promise<void> {
    const srcs = composition.layers
      .filter(l => l.type === 'video' && typeof l.properties.src === 'string')
      .map(l => l.properties.src as string);
    await Promise.all([...new Set(srcs)].filter(Boolean).map(src => this.loadVideoAsync(src)));
  }

  private loadVideoAsync(src: string): Promise<void> {
    if (this.videoCache.has(src)) return Promise.resolve();
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      const done = () => { this.videoCache.set(src, v); resolve(); };
      v.onloadeddata = done;
      v.onerror = () => resolve();
      v.src = src;
    });
  }

  /**
   * Seek every active video layer to the source time matching the given
   * composition time, and resolve once each pending seek has completed. The
   * exporter awaits this before rendering each frame so the canvas draws the
   * correct video frame (HTMLVideoElement seeking is async). Preview calls it
   * fire-and-forget — the frame catches up on the next tick.
   *
   * Source time = composition time − layer.startTime, clamped to the clip's
   * duration. Videos shorter than their layer window hold their last frame.
   */
  async seekVideos(composition: CompositionData, time: number): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const l of composition.layers) {
      if (l.type !== 'video' || l.visible === false) continue;
      const src = l.properties.src;
      if (typeof src !== 'string') continue;
      const v = this.videoCache.get(src);
      if (!v || v.readyState < 1) continue;
      const startTime = l.startTime ?? 0;
      const dur = l.layerDuration ?? (composition.duration - startTime);
      if (time < startTime || time > startTime + dur) continue;
      let sourceTime = time - startTime;
      if (Number.isFinite(v.duration) && v.duration > 0 && sourceTime > v.duration) {
        sourceTime = v.duration;
      }
      if (Math.abs(v.currentTime - sourceTime) < 1e-3) continue;
      waits.push(new Promise<void>((resolve) => {
        // Timeout guard: some WebMs (MediaRecorder output, no seek cues) can
        // fail to emit 'seeked' for a given target. Without this, the export
        // loop's `await` would hang forever. Resolve after 2s either way and
        // draw whatever frame is decoded — slow beats frozen.
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          v.removeEventListener('seeked', onSeeked);
          clearTimeout(timer);
          resolve();
        };
        const onSeeked = () => finish();
        const timer = setTimeout(finish, 2000);
        v.addEventListener('seeked', onSeeked);
        v.currentTime = sourceTime;
      }));
    }
    await Promise.all(waits);
  }

  /**
   * Drive video layers for live PREVIEW (not export). Two regimes:
   *  - Playing: let the <video> element PLAY in real time (it advances at the
   *    same wall-clock rate as the composition clock). Only re-seek to correct
   *    drift > 0.3s. Per-frame seeking would thrash and the element would never
   *    settle on a paintable frame.
   *  - Paused / scrubbing: PAUSE the element and seek ONCE to the target time.
   *    Seeking is async, so request a repaint (onImageLoad) when 'seeked'
   *    fires — otherwise a paused scrub shows a stale frame.
   * Inactive layers (outside their time window or hidden) are paused.
   * Best-effort and synchronous; the actual pixels are blitted by drawVideo.
   */
  syncVideos(composition: CompositionData, time: number, isPlaying: boolean): void {
    for (const l of composition.layers) {
      if (l.type !== 'video') continue;
      const src = l.properties.src;
      if (typeof src !== 'string') continue;
      const v = this.videoCache.get(src);
      if (!v) continue;
      const startTime = l.startTime ?? 0;
      const dur = l.layerDuration ?? (composition.duration - startTime);
      const active = l.visible !== false && time >= startTime && time <= startTime + dur;
      if (!active) {
        if (!v.paused) v.pause();
        continue;
      }
      let sourceTime = time - startTime;
      if (Number.isFinite(v.duration) && v.duration > 0 && sourceTime > v.duration) {
        sourceTime = v.duration;
      }
      if (isPlaying) {
        if (Math.abs(v.currentTime - sourceTime) > 0.3) {
          try { v.currentTime = sourceTime; } catch { /* not seekable yet */ }
        }
        if (v.paused) { void v.play().catch(() => { /* autoplay blocked — muted should allow it */ }); }
      } else {
        if (!v.paused) v.pause();
        if (v.readyState >= 1 && Math.abs(v.currentTime - sourceTime) > 0.04) {
          const onSeeked = () => { v.removeEventListener('seeked', onSeeked); this.onImageLoad?.(); };
          v.addEventListener('seeked', onSeeked);
          try { v.currentTime = sourceTime; } catch { /* not seekable yet */ }
        }
      }
    }
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
      this.drawLayer(layer, localTime, composition);
    }

    // Editor-only selection overlay. Drawn above content.
    if (this.selectedLayerId) {
      this.drawSelectionOverlay(composition, time);
    }

    // Editor-only mm grid and ruler — drawn before guides so guide lines sit on top.
    const mmPerPx = composition.meta?.scale?.mmPerPx;
    if (mmPerPx && mmPerPx > 0) {
      if (this.showGrid)  this.drawMmGrid(composition, mmPerPx);
      if (this.showRuler) this.drawMmRuler(composition, mmPerPx);
    }

    // Editor-only persisted ruler guides (composition.meta.guides) + any
    // in-progress draft guide. Drawn under the magenta smart guides so the
    // active snap indicator stays most prominent.
    if (this.showGuides) {
      this.drawGuides(composition);
    }

    // Editor-only smart guides (centre snap indicators). Drawn after the
    // selection overlay so they sit on top — easier to spot at a glance.
    if (this.snapGuides) {
      this.drawSnapGuides(composition);
    }
  }

  /**
   * Draw persisted ruler guides (cyan, solid) and the in-progress draft
   * guide (cyan, dashed). Composition-pixel coordinates map 1:1 to canvas
   * pixels here because the canvas is sized to the composition resolution.
   */
  private drawGuides(composition: CompositionData): void {
    const guides = composition.meta?.guides ?? [];
    if (guides.length === 0 && !this.draftGuide) return;
    this.ctx.save();
    this.ctx.strokeStyle = '#22d3ee'; // cyan-400 — Illustrator guide convention
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([]);
    for (const g of guides) {
      this.ctx.beginPath();
      if (g.axis === 'x') {
        this.ctx.moveTo(g.position, 0);
        this.ctx.lineTo(g.position, composition.height);
      } else {
        this.ctx.moveTo(0, g.position);
        this.ctx.lineTo(composition.width, g.position);
      }
      this.ctx.stroke();
    }
    if (this.draftGuide) {
      this.ctx.setLineDash([8, 6]);
      this.ctx.beginPath();
      if (this.draftGuide.axis === 'x') {
        this.ctx.moveTo(this.draftGuide.position, 0);
        this.ctx.lineTo(this.draftGuide.position, composition.height);
      } else {
        this.ctx.moveTo(0, this.draftGuide.position);
        this.ctx.lineTo(composition.width, this.draftGuide.position);
      }
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  /**
   * Editor-only mm grid overlay. Draws faint grid lines at `gridSizeMm`
   * intervals (minor) and 5× that interval (major). Adapts automatically —
   * if the mm→px scale makes minor lines too dense (< 4px apart) it steps up
   * to the next larger interval until lines are comfortably spaced.
   */
  private drawMmGrid(composition: CompositionData, mmPerPx: number): void {
    // pxPerMm = 1 / mmPerPx
    const pxPerMm = 1 / mmPerPx;
    // Choose a step size (in mm) that keeps lines at least 6px apart on screen.
    let stepMm = this.gridSizeMm;
    const minSpacingPx = 6;
    while (stepMm * pxPerMm < minSpacingPx) stepMm *= 2;
    const majorStepMm = stepMm * 5;
    const stepPx = stepMm * pxPerMm;
    const majorStepPx = majorStepMm * pxPerMm;
    const W = composition.width;
    const H = composition.height;

    this.ctx.save();
    // Minor grid lines.
    this.ctx.strokeStyle = 'rgba(148,163,184,0.15)'; // slate-400 very faint
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([]);
    for (let x = 0; x <= W; x += stepPx) {
      this.ctx.beginPath(); this.ctx.moveTo(x, 0); this.ctx.lineTo(x, H); this.ctx.stroke();
    }
    for (let y = 0; y <= H; y += stepPx) {
      this.ctx.beginPath(); this.ctx.moveTo(0, y); this.ctx.lineTo(W, y); this.ctx.stroke();
    }
    // Major grid lines.
    this.ctx.strokeStyle = 'rgba(148,163,184,0.35)';
    this.ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += majorStepPx) {
      this.ctx.beginPath(); this.ctx.moveTo(x, 0); this.ctx.lineTo(x, H); this.ctx.stroke();
    }
    for (let y = 0; y <= H; y += majorStepPx) {
      this.ctx.beginPath(); this.ctx.moveTo(0, y); this.ctx.lineTo(W, y); this.ctx.stroke();
    }
    this.ctx.restore();
  }

  /**
   * Editor-only mm ruler along the top and left edges of the canvas.
   * Tick marks and labels are in real-world mm derived from the composition scale.
   * The ruler band is 20px tall/wide; drawn above/left of the canvas content
   * but INSIDE the canvas rectangle (the ruler covers the outermost 20 px of the
   * composition — acceptable in edit mode where the outer margin is normally empty).
   */
  private drawMmRuler(composition: CompositionData, mmPerPx: number): void {
    const pxPerMm = 1 / mmPerPx;
    const W = composition.width;
    const H = composition.height;
    const BAND = 20; // ruler thickness in canvas px
    const FONT_SIZE = 9;

    // Choose label interval: at least 40px between labels.
    let labelStepMm = 10;
    const steps = [10, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    for (const s of steps) { if (s * pxPerMm >= 40) { labelStepMm = s; break; } }
    // Minor ticks at half the label step if ≥ 8px apart.
    const minorStepMm = (labelStepMm / 2) * pxPerMm >= 8 ? labelStepMm / 2 : labelStepMm;
    const minorStepPx = minorStepMm * pxPerMm;
    const labelStepPx = labelStepMm * pxPerMm;

    this.ctx.save();
    this.ctx.font = `${FONT_SIZE}px system-ui, sans-serif`;
    this.ctx.textBaseline = 'top';
    this.ctx.fillStyle = 'rgba(15,23,42,0.72)'; // near-black bg

    // ── Top ruler ────────────────────────────────────────────────────────────
    this.ctx.fillRect(0, 0, W, BAND);
    this.ctx.strokeStyle = 'rgba(148,163,184,0.6)';
    this.ctx.lineWidth = 1;
    // bottom border line
    this.ctx.beginPath(); this.ctx.moveTo(0, BAND); this.ctx.lineTo(W, BAND); this.ctx.stroke();
    this.ctx.fillStyle = '#94a3b8';
    for (let x = 0; x <= W; x += minorStepPx) {
      const isLabel = Math.round(x / labelStepPx) * labelStepPx === Math.round(x);
      const tickH = isLabel ? BAND * 0.55 : BAND * 0.3;
      this.ctx.beginPath();
      this.ctx.moveTo(x, BAND); this.ctx.lineTo(x, BAND - tickH);
      this.ctx.stroke();
      if (isLabel) {
        const mmVal = Math.round(x * mmPerPx);
        this.ctx.fillText(`${mmVal}`, x + 2, 2);
      }
    }

    // ── Left ruler ───────────────────────────────────────────────────────────
    this.ctx.fillStyle = 'rgba(15,23,42,0.72)';
    this.ctx.fillRect(0, 0, BAND, H);
    this.ctx.strokeStyle = 'rgba(148,163,184,0.6)';
    // right border line
    this.ctx.beginPath(); this.ctx.moveTo(BAND, 0); this.ctx.lineTo(BAND, H); this.ctx.stroke();
    this.ctx.fillStyle = '#94a3b8';
    for (let y = 0; y <= H; y += minorStepPx) {
      const isLabel = Math.round(y / labelStepPx) * labelStepPx === Math.round(y);
      const tickW = isLabel ? BAND * 0.55 : BAND * 0.3;
      this.ctx.beginPath();
      this.ctx.moveTo(BAND, y); this.ctx.lineTo(BAND - tickW, y);
      this.ctx.stroke();
      if (isLabel) {
        const mmVal = Math.round(y * mmPerPx);
        this.ctx.save();
        this.ctx.translate(2, y - 2);
        this.ctx.rotate(-Math.PI / 2);
        this.ctx.fillText(`${mmVal}`, 0, 0);
        this.ctx.restore();
      }
    }

    this.ctx.restore();
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
      // Paths hit-test against their stroke geometry, not a bounding box —
      // their declared size is usually the full canvas and would otherwise
      // swallow every click, making layers beneath them unselectable.
      if (layer.type === 'path') {
        if (hitTestPath(layer, localTime, canvasX, canvasY, composition)) return layer.id;
        continue;
      }
      const bounds = computeLayerBounds(layer, localTime, composition);
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
    // 8 resize handles (4 corners + 4 edge midpoints) — white fill + sky
    // border so they read over any image content. Illustrator layout.
    this.ctx.setLineDash([]);
    const dot = 12; // larger handle for an easier grab target (option B)
    const pts = selectionHandlePoints(bounds);
    for (const key of Object.keys(pts) as ResizeHandle[]) {
      const [dx, dy] = pts[key];
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(dx - dot / 2, dy - dot / 2, dot, dot);
      this.ctx.lineWidth = 2;
      this.ctx.strokeStyle = '#38bdf8';
      this.ctx.strokeRect(dx - dot / 2, dy - dot / 2, dot, dot);
    }
    // Rotation handle — circle above the top-centre handle, connected by a stem.
    const [rx, ry] = rotationHandlePoint(bounds);
    const [, ny] = pts['n'];
    this.ctx.strokeStyle = '#38bdf8';
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([]);
    this.ctx.beginPath();
    this.ctx.moveTo(rx, ny);
    this.ctx.lineTo(rx, ry + 7);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.arc(rx, ry, 7, 0, Math.PI * 2);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fill();
    this.ctx.strokeStyle = '#38bdf8';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    // Small arc arrow hint on the circle.
    this.ctx.beginPath();
    this.ctx.arc(rx, ry, 5, -Math.PI * 0.8, Math.PI * 0.2);
    this.ctx.strokeStyle = '#38bdf8';
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();
    this.ctx.restore();
  }

  /**
   * Hit-test the 8 resize handles of the currently selected layer. Returns the
   * handle under (canvasX, canvasY) within a grab tolerance, or null. Uses the
   * SAME bounds + handle points the overlay draws, so grab matches what's seen.
   * Time-gated identically to drawSelectionOverlay (no handles when the layer
   * isn't on-screen at this frame).
   */
  resizeHandleAt(canvasX: number, canvasY: number, composition: CompositionData, time: number): ResizeHandle | null {
    if (!this.selectedLayerId) return null;
    const layer = composition.layers.find(l => l.id === this.selectedLayerId);
    if (!layer || layer.visible === false) return null;
    // Resize is only meaningful for box layers; path layers draw from absolute
    // anchors and have no resizable box.
    if (layer.type === 'path') return null;
    const startTime = layer.startTime ?? 0;
    const layerDuration = layer.layerDuration ?? (composition.duration - startTime);
    if (time < startTime || time > startTime + layerDuration) return null;
    const bounds = computeLayerBounds(layer, time - startTime, composition);
    if (bounds === null) return null;
    const pts = selectionHandlePoints(bounds);
    const TOL = 10; // canvas px grab radius — half the 12px handle + margin
    let best: ResizeHandle | null = null;
    let bestD = Infinity;
    for (const key of Object.keys(pts) as ResizeHandle[]) {
      const [hx, hy] = pts[key];
      const d = Math.max(Math.abs(canvasX - hx), Math.abs(canvasY - hy));
      if (d <= TOL && d < bestD) { bestD = d; best = key; }
    }
    return best;
  }

  /**
   * Hit-test the rotation handle of the currently selected layer. Returns true
   * if (canvasX, canvasY) is within the grab radius of the handle, false otherwise.
   * Also returns the layer's centre point so the caller can compute angle deltas.
   */
  rotationHandleAt(
    canvasX: number, canvasY: number,
    composition: CompositionData, time: number,
  ): { cx: number; cy: number } | null {
    if (!this.selectedLayerId) return null;
    const layer = composition.layers.find(l => l.id === this.selectedLayerId);
    if (!layer || layer.visible === false) return null;
    const startTime = layer.startTime ?? 0;
    const layerDuration = layer.layerDuration ?? (composition.duration - startTime);
    if (time < startTime || time > startTime + layerDuration) return null;
    const bounds = computeLayerBounds(layer, time - startTime, composition);
    if (bounds === null) return null;
    const [rx, ry] = rotationHandlePoint(bounds);
    const dist = Math.hypot(canvasX - rx, canvasY - ry);
    if (dist > 14) return null; // generous grab radius
    // Centre of the layer bounding box — angle is measured from here.
    return { cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2 };
  }

  /**
   * Draw the smart-guide lines (magenta) through the canvas centre on each
   * axis the dragged layer is currently centred on. Illustrator / Figma idiom.
   * Solid 1-pixel line spanning the full canvas; doesn't bleed past the layer
   * (callers may want that someday, but full-span is more legible at a glance).
   */
  private drawSnapGuides(composition: CompositionData): void {
    if (!this.snapGuides) return;
    const { vertical, horizontal } = this.snapGuides;
    if (!vertical && !horizontal) return;
    this.ctx.save();
    this.ctx.strokeStyle = '#ec4899'; // pink-500 / magenta — same convention as Illustrator smart guides
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([]);
    if (vertical) {
      const x = composition.width / 2;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, composition.height);
      this.ctx.stroke();
    }
    if (horizontal) {
      const y = composition.height / 2;
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(composition.width, y);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private drawLayer(layer: Layer, time: number, composition?: CompositionData): void {
    const values = resolveLayerValues(layer, time, composition);
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
        this.drawMathShape(layer, values, time);
        break;
      case 'image':
        this.drawImage(layer, values);
        break;
      case 'video':
        this.drawVideo(layer, values);
        break;
      case 'kg-shape':
        this.drawKgShape(layer, values);
        break;
      case 'card':
        this.drawCard(layer, values);
        break;
      case 'path':
        this.drawPath(layer, values, composition);
        break;
      case 'knitting-chart':
        this.drawKnittingChart(layer, values, time);
        break;
      case 'telemetry-track':
        this.drawTelemetryTrack(layer, values);
        break;
    }

    this.ctx.restore();
  }

  /**
   * Draw a `type: 'knitting-chart'` layer — a pixelated stitch grid baked at
   * creation time. The palette + cell grid live in the layer properties, so no
   * source image is touched here (renders offline in the ffmpeg export). The
   * actual drawing is shared with the form's live preview via renderKnittingChart.
   */
  private drawKnittingChart(layer: Layer, values: Record<string, unknown>, time: number): void {
    const palette = values.palette as string[] | undefined;
    const cells = values.cells as string[] | undefined;
    const cols = values.cols as number | undefined;
    const rows = values.rows as number | undefined;
    if (!palette || !cells || !cols || !rows) return;

    const x = layer.position.x + ((values.offsetX as number) ?? 0);
    const y = layer.position.y + ((values.offsetY as number) ?? 0);
    const chart: KnittingChart = { cols, rows, palette, cells };

    // Pixel-by-pixel reveal: a 'pixel-reveal' animation drives a 0..1 progress
    // over the recorded paint sequence (properties.drawOrder), revealing cells
    // in the order they were painted. Same keyframe/easing path as mask-wipe.
    let reveal: { order: number[]; revealCount: number } | undefined;
    const pr = layer.animation?.kind === 'pixel-reveal'
      ? layer.animation
      : layer.animations?.find(a => a.kind === 'pixel-reveal');
    const order = layer.properties.drawOrder as number[] | undefined;
    if (pr && Array.isArray(order) && order.length > 0) {
      const progress = Math.max(0, Math.min(1, interpolate(pr.keyframes, time, pr.easing)));
      reveal = { order, revealCount: Math.floor(progress * order.length) };
    }

    renderKnittingChart(this.ctx, x, y, layer.size.width, layer.size.height, chart, {
      showGrid: values.showGrid !== false,
      showNumbers: values.showNumbers !== false,
      showLegend: values.showLegend !== false,
      background: (values.background as string) ?? '#ffffff',
      gridColor: (values.gridColor as string) ?? '#999999',
    }, reveal);
  }

  /**
   * Draw a `type: 'telemetry-track'` layer — one lane per meeting participant
   * across a shared time axis. Each lane has a `present` base span plus
   * `speaking` / `muted` / `videoOff` overlays. The animatable `progress`
   * (0..1, read the same nullish way as drawProgress) maps to a meeting-time
   * play-head: spans are drawn only up to the head, the span under the head is
   * highlighted (the live state), and the head advances as progress animates.
   * Pure geometry lives in layoutTelemetryTrack; this method only paints.
   */
  private drawTelemetryTrack(layer: Layer, values: Record<string, unknown>): void {
    const participants = values.participants as TelemetryTrackProps['participants'] | undefined;
    const meetingDurationMs = Number(values.meetingDurationMs);
    if (!Array.isArray(participants) || participants.length === 0 || !(meetingDurationMs > 0)) return;

    // 0 is a valid "nothing revealed yet" progress — use ?? not || (see drawProgress).
    const progress = Math.max(0, Math.min(1, Number(values.progress ?? 1)));

    const props: TelemetryTrackProps = {
      meetingDurationMs,
      participants,
      laneHeight: values.laneHeight as number | undefined,
      laneGap: values.laneGap as number | undefined,
      cornerRadius: values.cornerRadius as number | undefined,
      labelWidth: values.labelWidth as number | undefined,
      statWidth: values.statWidth as number | undefined,
      colors: values.colors as TelemetryTrackProps['colors'],
    };
    const geom = { x: layer.position.x, y: layer.position.y, width: layer.size.width, height: layer.size.height };
    const layout = layoutTelemetryTrack(props, geom, progress);

    const label = (values.label as { color?: string; font?: string; size?: number } | undefined) ?? {};
    const labelColor = label.color ?? '#1f2937';
    const labelFont = label.font ?? 'Inter';
    const labelSize = label.size ?? 13;
    const radius = layout.cornerRadius;
    const showPlayhead = values.showPlayhead !== false;
    const playheadColor = (values.playheadColor as string) ?? '#111827';
    const highlightActive = values.highlightActive !== false;
    const laneBg = (values.laneBg as string) ?? 'rgba(148,148,148,0.12)';

    const ctx = this.ctx;
    ctx.save();
    ctx.textBaseline = 'middle';

    for (const lane of layout.lanes) {
      const midY = lane.trackY + lane.height / 2;

      // lane background track (full width)
      ctx.fillStyle = laneBg;
      this.roundedRect(layout.trackX, lane.trackY, layout.trackW, lane.height, radius);
      ctx.fill();

      // present base first, then state overlays (already ordered by layout)
      for (const seg of lane.segments) {
        if (seg.w <= 0) continue;
        const r = Math.min(radius, seg.w / 2);
        ctx.fillStyle = seg.color;
        this.roundedRect(seg.x, lane.trackY, seg.w, lane.height, r);
        ctx.fill();
        if (highlightActive && seg.active) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          this.roundedRect(seg.x, lane.trackY, seg.w, lane.height, r);
          ctx.stroke();
        }
      }

      // name label (left of the track)
      ctx.fillStyle = labelColor;
      ctx.font = `${lane.host ? '600 ' : ''}${labelSize}px ${labelFont}`;
      ctx.textAlign = 'left';
      ctx.fillText(lane.host ? `${lane.name} · host` : lane.name, geom.x, midY);

      // talk% stat (right of the track)
      if (typeof lane.talkPct === 'number') {
        ctx.textAlign = 'right';
        ctx.fillText(`${lane.talkPct}% talk`, geom.x + geom.width, midY);
      }
    }

    // play-head — spans all lanes
    if (showPlayhead && layout.lanes.length > 0) {
      const first = layout.lanes[0];
      const last = layout.lanes[layout.lanes.length - 1];
      ctx.strokeStyle = playheadColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(layout.playheadX, first.trackY - 4);
      ctx.lineTo(layout.playheadX, last.trackY + last.height + 4);
      ctx.stroke();
    }

    // colour legend — a swatch + label per state, below the last lane
    if (values.showLegend !== false && layout.lanes.length > 0) {
      const colors = { ...DEFAULT_TELEMETRY_COLORS, ...((values.colors as Partial<Record<TelemetrySegType, string>>) ?? {}) };
      const legendNames: Record<TelemetrySegType, string> = {
        present: 'present', speaking: 'speaking', muted: 'muted', videoOff: 'video off',
        ...((values.legendLabels as Partial<Record<TelemetrySegType, string>>) ?? {}),
      };
      const order: TelemetrySegType[] = ['present', 'speaking', 'muted', 'videoOff'];
      const last = layout.lanes[layout.lanes.length - 1];
      const ly = last.trackY + last.height + 18;
      const sw = 13;
      ctx.font = `${labelSize}px ${labelFont}`;
      ctx.textAlign = 'left';
      let lx = geom.x;
      for (const t of order) {
        ctx.fillStyle = colors[t];
        this.roundedRect(lx, ly - sw / 2, sw, sw, 3);
        ctx.fill();
        lx += sw + 6;
        ctx.fillStyle = labelColor;
        ctx.fillText(legendNames[t], lx, ly);
        lx += ctx.measureText(legendNames[t]).width + 18;
      }
    }

    ctx.textAlign = 'left';
    ctx.restore();
  }

  /**
   * Draw a `type: 'path'` layer — a polyline / Bezier curve defined by
   * an `anchors` array. Each segment is straight if either endpoint
   * lacks the relevant handle (anchor[i].out + anchor[i+1].in); cubic
   * Bezier via ctx.bezierCurveTo if both handles are present. `closed`
   * adds a closing segment from the last anchor back to the first.
   *
   * If `showInPreview` is false, the path is invisible at render time —
   * useful when the path exists only as a motion source for a dot.
   */
  private drawPath(_layer: Layer, values: Record<string, unknown>, composition?: CompositionData): void {
    const anchors = values.anchors as PathAnchor[] | undefined;
    if (!Array.isArray(anchors) || anchors.length < 2) return;
    const showInPreview = values.showInPreview !== false; // default true
    if (!showInPreview) return;
    const stroke = (values.strokeColor as string) ?? '#94a3b8';
    const strokeWidth = (values.strokeWidth as number) ?? 2;
    const closed = (values.closed as boolean) ?? false;
    const pathRotation = (values.rotation as number | undefined) ?? 0;

    this.ctx.save();
    if (pathRotation !== 0) {
      // Rotate around the path's own bounding-box centre.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const a of anchors) {
        if (a.x < minX) minX = a.x; if (a.x > maxX) maxX = a.x;
        if (a.y < minY) minY = a.y; if (a.y > maxY) maxY = a.y;
      }
      const pcx = (minX + maxX) / 2;
      const pcy = (minY + maxY) / 2;
      this.ctx.translate(pcx, pcy);
      this.ctx.rotate(pathRotation * Math.PI / 180);
      this.ctx.translate(-pcx, -pcy);
    }
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = strokeWidth;
    this.ctx.beginPath();
    this.ctx.moveTo(anchors[0].x, anchors[0].y);
    const drawSegment = (a: PathAnchor, b: PathAnchor) => {
      // A segment is a cubic Bezier when EITHER endpoint contributes a
      // handle. The missing-handle side falls back to the anchor position
      // itself (degenerate control point), producing a one-sided curve.
      // This means right-clicking a single anchor to smooth-it immediately
      // bends both adjacent segments — the natural authoring expectation.
      if (a.out || b.in) {
        const c1x = a.out ? a.x + a.out.x : a.x;
        const c1y = a.out ? a.y + a.out.y : a.y;
        const c2x = b.in  ? b.x + b.in.x  : b.x;
        const c2y = b.in  ? b.y + b.in.y  : b.y;
        this.ctx.bezierCurveTo(c1x, c1y, c2x, c2y, b.x, b.y);
      } else {
        this.ctx.lineTo(b.x, b.y);
      }
    };
    for (let i = 1; i < anchors.length; i += 1) {
      drawSegment(anchors[i - 1], anchors[i]);
    }
    if (closed) {
      drawSegment(anchors[anchors.length - 1], anchors[0]);
    }
    this.ctx.stroke();
    this.ctx.restore();

    // Measurement annotations: anchor letter labels (A, B, C…) and segment lengths.
    // Guarded by showLabels — false turns off the whole block; absent or true = show.
    if (values.showLabels !== false) {
      const measurements = values.measurements as { mmPerPx?: number } | undefined;
      const activeMmPerPx = (measurements?.mmPerPx && measurements.mmPerPx > 0)
        ? measurements.mmPerPx
        : (composition?.meta?.scale?.mmPerPx ?? 0);
      const labelFontSize = Math.max(14, Math.min(28, this.canvas.width / 60));
      const segFontSize = Math.max(11, labelFontSize * 0.78);
      this.ctx.save();
      this.ctx.textBaseline = 'alphabetic';

      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        const label = String.fromCharCode(65 + i);
        this.ctx.font = `bold ${labelFontSize}px sans-serif`;
        this.ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        this.ctx.lineWidth = labelFontSize * 0.15;
        this.ctx.strokeText(label, a.x + labelFontSize * 0.8, a.y - labelFontSize * 0.5);
        this.ctx.fillStyle = '#f8fafc';
        this.ctx.fillText(label, a.x + labelFontSize * 0.8, a.y - labelFontSize * 0.5);
      }

      this.ctx.font = `${segFontSize}px sans-serif`;
      for (let i = 0; i + 1 < anchors.length; i++) {
        const a = anchors[i];
        const b = anchors[i + 1];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const pxLen = Math.hypot(b.x - a.x, b.y - a.y);
        const text = activeMmPerPx > 0
          ? `${Math.round(pxLen * activeMmPerPx)} mm`
          : `${Math.round(pxLen)} px`;
        this.ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        this.ctx.lineWidth = segFontSize * 0.18;
        this.ctx.strokeText(text, mx + segFontSize * 0.5, my - segFontSize * 0.3);
        this.ctx.fillStyle = '#94a3b8';
        this.ctx.fillText(text, mx + segFontSize * 0.5, my - segFontSize * 0.3);
      }

      this.ctx.restore();
    }
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
          // Composite onto main canvas at layer position, with optional rotation.
          // globalAlpha (from drawLayer) and any mask-wipe clip both still apply.
          const rot = (values.rotation as number | undefined) ?? 0;
          if (rot !== 0) {
            this.ctx.save();
            const cx = layerLeft + lw / 2;
            const cy = layerTop + lh / 2;
            this.ctx.translate(cx, cy);
            this.ctx.rotate(rot * Math.PI / 180);
            this.ctx.drawImage(off, -lw / 2, -lh / 2);
            this.ctx.restore();
          } else {
            this.ctx.drawImage(off, layerLeft, layerTop);
          }
          return;
        }
      }
      // Else: image not ready — fall through to solid path for this frame.
    }

    // ── Solid path (existing behaviour) ─────────────────────────────────────
    this.ctx.save();
    const rotation = (values.rotation as number | undefined) ?? 0;
    if (rotation !== 0) {
      const cx = layerLeft + maxWidth / 2;
      const cy = layerTop + layer.size.height / 2;
      this.ctx.translate(cx, cy);
      this.ctx.rotate(rotation * Math.PI / 180);
      this.ctx.translate(-cx, -cy);
    }
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
          const val = interpolate(anim.keyframes, charTime, anim.easing);
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

    const kgRotation = (values.rotation as number | undefined) ?? 0;
    this.ctx.save();
    if (kgRotation !== 0) {
      const cx = offsetX + layer.size.width / 2;
      const cy = offsetY + layer.size.height / 2;
      this.ctx.translate(cx, cy);
      this.ctx.rotate(kgRotation * Math.PI / 180);
      this.ctx.translate(-cx, -cy);
    }
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
    const rotation = (values.rotation as number | undefined) ?? 0;
    if (rotation !== 0) {
      this.ctx.save();
      this.ctx.translate(x + w / 2, y + h / 2);
      this.ctx.rotate(rotation * Math.PI / 180);
      this.ctx.translate(-(x + w / 2), -(y + h / 2));
    }
    const borderRadius = (values.borderRadius as number) ?? 0;
    // Stroke is optional — requires BOTH strokeColor (truthy string) and
    // strokeWidth > 0, matching the math-shape / kg-shape convention.
    // Stroked AFTER fill so the outline sits on top of the fill colour.
    const strokeColor = (typeof values.strokeColor === 'string' && values.strokeColor)
      ? (values.strokeColor as string)
      : null;
    const strokeWidth = typeof values.strokeWidth === 'number' ? values.strokeWidth as number : 0;
    const willStroke = strokeColor !== null && strokeWidth > 0;

    this.ctx.fillStyle = color;

    if (shape === 'circle') {
      this.ctx.beginPath();
      this.ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      this.ctx.fill();
      if (willStroke) {
        this.ctx.strokeStyle = strokeColor!;
        this.ctx.lineWidth = strokeWidth;
        this.ctx.stroke();
      }
    } else if (borderRadius > 0) {
      this.roundedRect(x, y, w, h, borderRadius);
      this.ctx.fill();
      if (willStroke) {
        this.ctx.strokeStyle = strokeColor!;
        this.ctx.lineWidth = strokeWidth;
        this.ctx.stroke();
      }
    } else {
      this.ctx.fillRect(x, y, w, h);
      if (willStroke) {
        this.ctx.strokeStyle = strokeColor!;
        this.ctx.lineWidth = strokeWidth;
        this.ctx.strokeRect(x, y, w, h);
      }
    }
    if (rotation !== 0) this.ctx.restore();
  }

  private drawMathShape(layer: Layer, values: Record<string, unknown>, time = 0): void {
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

    // Read amp values from values (set once per layer per frame by
    // resolveLayerValues from composition.meta.audioTrack at absolute
    // composition time). Constant across the whole parametric sweep —
    // every sample gets the same amp for this frame.
    const ampVal = typeof values.__amp === 'number' ? values.__amp : 0;
    const ampLVal = typeof values.__ampL === 'number' ? values.__ampL : 0;
    const ampRVal = typeof values.__ampR === 'number' ? values.__ampR : 0;

    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= samples; i += 1) {
      const p = i / samples;
      const t = tStart + (tEnd - tStart) * p;
      const context = {
        t, p, start: tStart, end: tEnd, duration: tEnd - tStart, x0: x, y0: y, w, h,
        amp: ampVal, ampL: ampLVal, ampR: ampRVal,
        // Layer-local composition time (seconds). Lets a formula animate over
        // wall-clock time — e.g. a rotating 3D projection (spin) that renders
        // to MP4 with no per-frame layer regeneration.
        time,
      };
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

    const imgRotation = (values.rotation as number | undefined) ?? 0;
    if (imgRotation !== 0) {
      this.ctx.save();
      this.ctx.translate(x + w / 2, y + h / 2);
      this.ctx.rotate(imgRotation * Math.PI / 180);
      this.ctx.translate(-(x + w / 2), -(y + h / 2));
    }

    // Optional clip mask (collage cut-out). Applied within drawLayer's
    // save/restore, so the clip is scoped to this layer only. The mask is
    // mapped from the SAME draw rect as the image (x,y,w,h) — which already
    // includes the animation offset — and the layer scale transform is already
    // on ctx, so the clip travels + scales with the image automatically.
    // feather > 0 → soft edge (offscreen alpha mask); otherwise a hard clip.
    const patches = Array.isArray(values.patches) ? (values.patches as ImagePatch[]) : undefined;

    // Border params. globalAlpha (layer opacity) is already on ctx, so the
    // border fades with the layer either way.
    const borderWidth = typeof values.borderWidth === 'number' ? (values.borderWidth as number) : 0;
    const borderColor = typeof values.borderColor === 'string' ? (values.borderColor as string) : '';
    const hasBorder = borderWidth > 0 && !!borderColor;

    const mask = values.mask as PathMask | undefined;
    if (mask && mask.type === 'path' && Array.isArray(mask.anchors) && mask.anchors.length >= 3) {
      const feather = typeof mask.feather === 'number' && mask.feather > 0 ? mask.feather : 0;
      if (feather > 0) {
        this.drawImageFeatheredMask(img, x, y, w, h, fit, mask, feather);
        if (patches) this.drawPatches(img, x, y, w, h, fit, patches);
      } else {
        // Scope the clip to its own save/restore so the border stroke below
        // (the SAME outline) isn't cut in half by the clip.
        this.ctx.save();
        this.clipToMask(mask, x, y, w, h);
        drawImageFitted(this.ctx, img, x, y, w, h, fit);
        if (patches) this.drawPatches(img, x, y, w, h, fit, patches);
        this.ctx.restore();
      }
      // Border on a cut-out = stroke the mask outline (the cut shape), not a
      // rectangle. Unclipped, so the full stroke width shows on the edge.
      if (hasBorder) this.strokeMaskOutline(mask, x, y, w, h, borderColor, borderWidth);
      return;
    }

    drawImageFitted(this.ctx, img, x, y, w, h, fit);
    if (patches) this.drawPatches(img, x, y, w, h, fit, patches);

    // Border stroke around the (rectangular) image.
    if (hasBorder) {
      this.ctx.strokeStyle = borderColor;
      this.ctx.lineWidth = borderWidth;
      this.ctx.strokeRect(x, y, w, h);
    }
    if (imgRotation !== 0) this.ctx.restore();
  }

  /**
   * Stroke a mask outline as the image's border (the cut shape's edge). Traces
   * the same closed outline used for clipping and strokes it — round joins so a
   * hand-drawn shape's corners read smoothly. Caller decides colour/width; the
   * ctx already carries the layer scale + opacity.
   */
  private strokeMaskOutline(mask: PathMask, originX: number, originY: number, w: number, h: number, color: string, width: number): void {
    this.ctx.beginPath();
    const traced = this.appendMaskOutline(this.ctx, mask, originX, originY, w, h);
    if (!traced) return;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.lineJoin = 'round';
    this.ctx.stroke();
  }

  /**
   * Append an image layer's local-space mask outline to `ctx`'s CURRENT path as
   * one closed subpath (does NOT call beginPath or clip/fill — caller decides,
   * so an outer rect can be prepended for the inverted/even-odd case). Anchors
   * are 0..1 fractions of the layer box; (originX, originY, w, h) is the draw
   * rect. Bezier handles (in/out) are fractional offsets in the same space.
   * Returns false (nothing appended) for < 3 anchors. Mirrors drawPath's logic.
   */
  private appendMaskOutline(ctx: CanvasRenderingContext2D, mask: PathMask, originX: number, originY: number, w: number, h: number): boolean {
    return this.appendOutline(ctx, mask.anchors, originX, originY, w, h);
  }

  /**
   * Trace a closed outline (anchor list in local 0..1) onto `ctx`'s CURRENT path
   * as one closed subpath — shared by image masks (appendMaskOutline) and clone
   * patches (drawPatches). Does NOT begin/clip/fill; the caller decides. Returns
   * false (nothing appended) for < 3 anchors.
   */
  private appendOutline(ctx: CanvasRenderingContext2D, anchors: PathAnchor[], originX: number, originY: number, w: number, h: number): boolean {
    if (!Array.isArray(anchors) || anchors.length < 3) return false;
    const px = (a: PathAnchor) => originX + a.x * w;
    const py = (a: PathAnchor) => originY + a.y * h;
    ctx.moveTo(px(anchors[0]), py(anchors[0]));
    const seg = (a: PathAnchor, b: PathAnchor) => {
      if (a.out || b.in) {
        const c1x = a.out ? px(a) + a.out.x * w : px(a);
        const c1y = a.out ? py(a) + a.out.y * h : py(a);
        const c2x = b.in  ? px(b) + b.in.x  * w : px(b);
        const c2y = b.in  ? py(b) + b.in.y  * h : py(b);
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, px(b), py(b));
      } else {
        ctx.lineTo(px(b), py(b));
      }
    };
    for (let i = 1; i < anchors.length; i += 1) seg(anchors[i - 1], anchors[i]);
    seg(anchors[anchors.length - 1], anchors[0]); // masks are always closed
    return true;
  }

  /**
   * Hard-edge mask clip. `invert` clips OUTSIDE the outline (keep everything
   * except the shape): trace the draw-rect rectangle PLUS the mask outline and
   * clip with the even-odd rule, so the mask region becomes the hole.
   */
  private clipToMask(mask: PathMask, originX: number, originY: number, w: number, h: number): void {
    this.ctx.beginPath();
    if (mask.invert) this.ctx.rect(originX, originY, w, h);
    const traced = this.appendMaskOutline(this.ctx, mask, originX, originY, w, h);
    if (!traced && !mask.invert) return;
    this.ctx.clip(mask.invert ? 'evenodd' : 'nonzero');
  }

  /**
   * Soft-edge mask: draw the image into an offscreen canvas the size of the
   * draw rect (padded by the blur falloff), knock it out with a blurred white
   * fill of the mask via `destination-in`, then blit the result back. The blur
   * radius IS the feather width; the padding keeps the soft edge from being
   * clipped by the offscreen bounds. Runs under the main ctx's scale + alpha,
   * so a feathered mask still travels/scales with the image like the hard one.
   *
   * `invert` keeps the area OUTSIDE the outline: fill the whole (padded)
   * offscreen and even-odd-subtract the mask, so only the hole edge is
   * feathered — the image's own border stays crisp (the outer rect's blurred
   * edge falls in the padding, beyond the image).
   */
  private drawImageFeatheredMask(img: HTMLImageElement, x: number, y: number, w: number, h: number, fit: string, mask: PathMask, feather: number): void {
    const pad = Math.ceil(feather * 3); // cover the blur falloff on every side
    const off = document.createElement('canvas');
    off.width  = Math.max(1, Math.ceil(w) + pad * 2);
    off.height = Math.max(1, Math.ceil(h) + pad * 2);
    const octx = off.getContext('2d');
    if (!octx) { drawImageFitted(this.ctx, img, x, y, w, h, fit); return; }
    // Image sits at (pad,pad) so the soft edge has room to bleed into the pad.
    drawImageFitted(octx, img, pad, pad, w, h, fit);
    octx.globalCompositeOperation = 'destination-in';
    octx.filter = `blur(${feather}px)`;
    octx.fillStyle = '#ffffff';
    octx.beginPath();
    if (mask.invert) octx.rect(0, 0, off.width, off.height);
    this.appendMaskOutline(octx, mask, pad, pad, w, h);
    octx.fill(mask.invert ? 'evenodd' : 'nonzero');
    octx.filter = 'none';
    octx.globalCompositeOperation = 'source-over';
    // Blit so the offscreen's (pad,pad) lands at the image's (x,y).
    this.ctx.drawImage(off, x - pad, y - pad);
  }

  /**
   * Draw clone/heal patches over an already-drawn image. Each patch copies clean
   * texture from `outline + source` onto `outline` — covering a blemish/tag with
   * nearby pixels of the SAME image. Done by clipping to the outline and redrawing
   * the image translated by `-source`, so the source region's pixels land in the
   * clipped region. feather > 0 routes through an offscreen alpha mask (same path
   * as drawImageFeatheredMask) so the clone blends into its surroundings.
   * (x,y,w,h,fit) is the image's draw rect — identical to drawImage's base draw.
   */
  private drawPatches(img: HTMLImageElement, x: number, y: number, w: number, h: number, fit: string, patches: ImagePatch[]): void {
    for (const patch of patches) {
      const outline = patch?.outline;
      if (!Array.isArray(outline) || outline.length < 3) continue;
      const dx = patch.source?.dx ?? 0;
      const dy = patch.source?.dy ?? 0;
      // Shifted draw origin: drawing the image at (x - source) makes the texture
      // at (outline + source) appear under the outline once we clip to it.
      const sx = x - dx * w;
      const sy = y - dy * h;
      const feather = typeof patch.feather === 'number' && patch.feather > 0 ? patch.feather : 0;

      if (feather > 0) {
        const pad = Math.ceil(feather * 3);
        const off = document.createElement('canvas');
        off.width = Math.max(1, Math.ceil(w) + pad * 2);
        off.height = Math.max(1, Math.ceil(h) + pad * 2);
        const octx = off.getContext('2d');
        if (octx) {
          // Shifted source image, positioned in the offscreen so its (x,y) maps to (pad,pad).
          drawImageFitted(octx, img, pad + (sx - x), pad + (sy - y), w, h, fit);
          octx.globalCompositeOperation = 'destination-in';
          octx.filter = `blur(${feather}px)`;
          octx.fillStyle = '#ffffff';
          octx.beginPath();
          this.appendOutline(octx, outline, pad, pad, w, h);
          octx.fill('nonzero');
          octx.filter = 'none';
          octx.globalCompositeOperation = 'source-over';
          this.ctx.drawImage(off, x - pad, y - pad);
          continue;
        }
        // No offscreen context → fall through to a hard-edged clone.
      }

      this.ctx.save();
      this.ctx.beginPath();
      this.appendOutline(this.ctx, outline, x, y, w, h);
      this.ctx.clip();
      drawImageFitted(this.ctx, img, sx, sy, w, h, fit);
      this.ctx.restore();
    }
  }

  /**
   * Draw a video layer's current frame. Mirrors drawImage but pulls pixels
   * from an HTMLVideoElement. The element's currentTime is driven by
   * seekVideos (export) / the playback controller (preview); here we just
   * blit whatever frame is currently decoded. Lazily creates + caches the
   * element on first sight (matching drawImage's lazy-load behaviour) so a
   * video added after preloadVideos still appears once it buffers.
   */
  private drawVideo(layer: Layer, values: Record<string, unknown>): void {
    const src = (values.src as string) ?? '';
    if (!src) return;

    const x = layer.position.x + ((values.offsetX as number) ?? 0);
    const y = layer.position.y + ((values.offsetY as number) ?? 0);
    const w = layer.size.width;
    const h = layer.size.height;
    const fit = (values.fit as string) ?? 'cover';

    let v = this.videoCache.get(src);

    if (!v) {
      v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.onloadeddata = () => { this.onImageLoad?.(); };
      v.onerror = () => { /* keep placeholder */ };
      v.src = src;
      this.videoCache.set(src, v);
      return;
    }

    // readyState < 2 (HAVE_CURRENT_DATA) → no frame to paint yet.
    if (v.readyState < 2 || v.videoWidth === 0) return;

    drawImageFitted(this.ctx, v, x, y, w, h, fit);
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
    // Sync video layers to the playhead. When playing, they play in real time;
    // when paused/scrubbing, a single seek + repaint-on-seeked shows the frame.
    this.renderer.syncVideos(this.composition, this.frameNumber / this.composition.fps, this.rafId !== null);
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
    // Pause any playing video layers so they don't keep advancing past the
    // (now stationary) playhead.
    this.renderer.syncVideos(this.composition, this.frameNumber / this.composition.fps, false);
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
    this.renderer.syncVideos(this.composition, this.frameNumber / this.composition.fps, true);
    void this.renderer.renderFrame(this.composition, this.frameNumber);
    this.onFrameChange?.(this.frameNumber);

    this.rafId = requestAnimationFrame(this.tick);
  };
}
