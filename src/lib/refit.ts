import type { Animation, CompositionData, Keyframe, Layer } from './api';

/**
 * Refit modes:
 *   fit     — uniform scale = min(sx, sy); content fits entirely inside the new
 *             canvas, may leave bars on the longer axis (letterbox).
 *   fill    — uniform scale = max(sx, sy); content fills the new canvas, may
 *             clip on the shorter axis (cover).
 *   stretch — independent x/y scale; no bars, no clipping, but shapes distort.
 */
export type RefitMode = 'fit' | 'fill' | 'stretch';

/**
 * Numeric properties on a layer that represent absolute pixel sizes and
 * should scale with the layer (so text doesn't end up at the wrong physical
 * size, padding doesn't end up huge, etc).
 *
 * These all scale by a UNIFORM factor (`fontScale` below) — for stretch
 * mode that's `min(sx, sy)`, so text & spacing stay legible inside whatever
 * the squished layer rect becomes.
 */
const UNIFORM_SCALABLE_PROPS = [
  'fontSize',
  'strokeWidth',
  'titleFontSize',
  'bodyFontSize',
  'padding',
  'gap',
  'borderRadius',
];

/**
 * Pure function — returns a new composition with the canvas resized and
 * every layer scaled to suit. Does not mutate the input.
 *
 * Known caveats (callers should surface to the user):
 *   - math-shape `xFormula` / `yFormula` with hard-coded pixel constants
 *     (e.g. `t * 60`) don't auto-scale; only `x0`, `y0`, `w`, `h` references
 *     adapt. Same for motionScenes formulas.
 *   - `fillSource` image URLs aren't re-fetched at a new size; the renderer
 *     already cover/contain-fits images at runtime so this is usually fine.
 */
export function refitComposition(
  composition: CompositionData,
  targetWidth: number,
  targetHeight: number,
  mode: RefitMode,
): CompositionData {
  const oldW = composition.width;
  const oldH = composition.height;

  if (oldW <= 0 || oldH <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return composition;
  }

  let sx: number;
  let sy: number;
  let offsetX: number;
  let offsetY: number;

  if (mode === 'stretch') {
    sx = targetWidth / oldW;
    sy = targetHeight / oldH;
    offsetX = 0;
    offsetY = 0;
  } else {
    const ratioX = targetWidth / oldW;
    const ratioY = targetHeight / oldH;
    const s = mode === 'fit' ? Math.min(ratioX, ratioY) : Math.max(ratioX, ratioY);
    sx = s;
    sy = s;
    // Centre the scaled content in the new canvas. For 'fill' the offset
    // is negative on the overflow axis, which intentionally clips.
    offsetX = (targetWidth - oldW * s) / 2;
    offsetY = (targetHeight - oldH * s) / 2;
  }

  const fontScale = Math.min(sx, sy);

  return {
    ...composition,
    width: targetWidth,
    height: targetHeight,
    layers: composition.layers.map(layer => refitLayer(layer, sx, sy, offsetX, offsetY, fontScale)),
  };
}

function refitLayer(
  layer: Layer,
  sx: number,
  sy: number,
  ox: number,
  oy: number,
  fontScale: number,
): Layer {
  const nextProperties: Record<string, unknown> = { ...layer.properties };
  for (const key of UNIFORM_SCALABLE_PROPS) {
    const v = nextProperties[key];
    if (typeof v === 'number') {
      nextProperties[key] = v * fontScale;
    }
  }

  const next: Layer = {
    ...layer,
    position: {
      x: layer.position.x * sx + ox,
      y: layer.position.y * sy + oy,
    },
    size: {
      width: layer.size.width * sx,
      height: layer.size.height * sy,
    },
    properties: nextProperties,
  };

  if (layer.animation) next.animation = refitAnimation(layer.animation, sx, sy);
  if (layer.animations) next.animations = layer.animations.map(a => refitAnimation(a, sx, sy));

  return next;
}

/**
 * Scale animation keyframe values for the property types that represent
 * absolute pixels:
 *   offsetX → scales by sx
 *   offsetY → scales by sy
 * Other layer-kind properties (opacity, scale, drawProgress) are unitless
 * and untouched. char-stagger / mask-wipe kinds are also untouched —
 * char-stagger's value is the same property type as a layer animation
 * (and per-glyph offsets follow the layer's own scaling); mask-wipe is
 * a 0..1 progress, not a pixel value.
 */
function refitAnimation(anim: Animation, sx: number, sy: number): Animation {
  if (anim.kind === 'mask-wipe') return anim;
  if (anim.property !== 'offsetX' && anim.property !== 'offsetY') return anim;
  const factor = anim.property === 'offsetX' ? sx : sy;
  return {
    ...anim,
    keyframes: anim.keyframes.map((k): Keyframe => ({
      ...k,
      value: typeof k.value === 'number' ? k.value * factor : k.value,
    })),
  };
}
