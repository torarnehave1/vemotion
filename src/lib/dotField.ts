// Pure logic for the `dot-field` layer type. No canvas, no DOM — renderer.ts draws what
// computeDots() returns, the same split as telemetryTrack.ts.
//
// A dot-field is a math-shape that draws a DOT at each sample instead of joining the samples
// with a line: one layer, `count` dots, each placed by the same x/y formulas with the dot's own
// number available as `i`. It exists because a "living body" of a few hundred dots cost a few
// hundred layers before (found 2026-11-10, when the IIBA films had to be drawn outside VEmotion).
//
// Formula vocabulary = the math-shape vocabulary (so any curve preset can be dropped in and the
// dots sit along that curve) plus what only makes sense per dot:
//
//   i     the dot's number, 0 … n-1
//   n     how many dots (`count`)
//   u     i / n            — 0 up to but not including 1: closed layouts (a ring has no doubled dot)
//   p     i / (n-1)        — 0 up to and including 1: open layouts (a line reaches both ends)
//   t     tStart + (tEnd - tStart) * p   — the math-shape sweep parameter, default 0 … 2π
//   time  seconds on the layer clock
//   rnd, rnd2   two fixed random numbers 0 … 1 per dot — the same in every frame, so a cluster
//               does not shimmer. Change `seed` for another arrangement.
//   m     the layer's animatable `m` property (default 0). Keyframe it 0 → 1 and use it in a
//         formula to slide between two layouts, or to drive anything else.
//   r     the layer's `radius` property, for radiusFormula ("r * (1 + 0.2*sin(time*2))")
//   x0, y0, w, h, amp, ampL, ampR, start, end, duration   as in math-shape
//   sin cos tan abs min max pow sqrt pi   as in math-shape
//   floor(x)          rows and columns of a grid
//   smooth(a, b, x)   0 below a, 1 above b, a soft S-curve between — gentle starts and stops

export const DOT_FIELD_MAX_COUNT = 2000;
export const DOT_FIELD_DEFAULT_COUNT = 120;
export const DOT_FIELD_DEFAULT_RADIUS = 6;
export const DOT_FIELD_DEFAULT_COLOR = '#38bdf8';

export type Dot = { x: number; y: number; r: number; alpha: number; color: string };

export type DotFieldBox = { x0: number; y0: number; w: number; h: number };

export type DotFieldAmp = { amp: number; ampL: number; ampR: number };

const ARG_NAMES = [
  't', 'p', 'start', 'end', 'duration', 'x0', 'y0', 'w', 'h',
  'amp', 'ampL', 'ampR', 'time',
  'i', 'n', 'u', 'rnd', 'rnd2', 'm', 'r',
  'sin', 'cos', 'tan', 'abs', 'min', 'max', 'pow', 'sqrt', 'pi',
  'floor', 'smooth',
] as const;

type Compiled = (...args: number[] | unknown[]) => number;

/** 0 below a, 1 above b, smoothstep between. a === b is a hard step at a. */
export function smooth(a: number, b: number, x: number): number {
  if (a === b) return x < a ? 0 : 1;
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

/** A fixed pseudo-random number 0 … 1 for dot `i` — pure, so every frame agrees. */
export function dotRandom(i: number, seed: number, salt: number): number {
  let h = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul((seed | 0) + 1, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// One compile per distinct formula, not per dot per frame: 2000 dots × 5 formulas × 30 fps
// through `new Function` would stall the preview. Bounded so a long editing session that types
// many formulas cannot grow it without limit.
const compiled = new Map<string, Compiled | null>();
const COMPILED_MAX = 200;

/**
 * Compile a dot-field formula, or null when it is empty or outside the vocabulary. Same
 * character whitelist as the math-shape evaluator in renderer.ts — letters, digits, arithmetic,
 * parentheses, commas — so nothing but the names above can be reached.
 */
export function compileDotFormula(formula: unknown): Compiled | null {
  if (typeof formula !== 'string') return null;
  const safe = formula.trim();
  if (!safe) return null;
  const hit = compiled.get(safe);
  if (hit !== undefined) return hit;
  let fn: Compiled | null = null;
  if (/^[0-9+\-*/%().,\s_a-zA-Z]+$/.test(safe)) {
    try {
      fn = new Function(...ARG_NAMES, `"use strict"; return (${safe});`) as Compiled;
    } catch {
      fn = null;
    }
  }
  if (compiled.size >= COMPILED_MAX) compiled.clear();
  compiled.set(safe, fn);
  return fn;
}

/** null when the formula is fine; otherwise why it draws nothing. For the edit form. */
export function dotFormulaProblem(formula: unknown, box: DotFieldBox = { x0: 0, y0: 0, w: 100, h: 100 }): string | null {
  if (typeof formula !== 'string' || !formula.trim()) return null;
  if (!/^[0-9+\-*/%().,\s_a-zA-Z]+$/.test(formula.trim())) return 'Only letters, digits, + - * / % ( ) and commas. No ^ — use pow(a, b).';
  const fn = compileDotFormula(formula);
  if (!fn) return 'This does not read as a formula — check the brackets.';
  const v = run(fn, { ...box, i: 0, n: 10, time: 0, m: 0, r: DOT_FIELD_DEFAULT_RADIUS, seed: 1, tStart: 0, tEnd: Math.PI * 2, amp: 0, ampL: 0, ampR: 0 });
  if (v === null) return 'This uses a name the dot-field does not know, or gives no number.';
  return null;
}

type RunCtx = DotFieldBox & DotFieldAmp & {
  i: number; n: number; time: number; m: number; r: number; seed: number; tStart: number; tEnd: number;
};

function run(fn: Compiled, c: RunCtx): number | null {
  const u = c.n > 0 ? c.i / c.n : 0;
  const p = c.n > 1 ? c.i / (c.n - 1) : 0;
  const t = c.tStart + (c.tEnd - c.tStart) * p;
  try {
    const v = fn(
      t, p, c.tStart, c.tEnd, c.tEnd - c.tStart, c.x0, c.y0, c.w, c.h,
      c.amp, c.ampL, c.ampR, c.time,
      c.i, c.n, u, dotRandom(c.i, c.seed, 0), dotRandom(c.i, c.seed, 1), c.m, c.r,
      Math.sin, Math.cos, Math.tan, Math.abs, Math.min, Math.max, Math.pow, Math.sqrt, Math.PI,
      Math.floor, smooth,
    );
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function parseHex(color: unknown): [number, number, number] | null {
  if (typeof color !== 'string') return null;
  const s = color.trim();
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m) return [parseInt(m[1] + m[1], 16), parseInt(m[2] + m[2], 16), parseInt(m[3] + m[3], 16)];
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  return null;
}

/** Blend two #rgb / #rrggbb colours; k = 0 is `a`, 1 is `b`. Anything else falls back to `a`. */
export function mixColors(a: string, b: unknown, k: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const q = Math.max(0, Math.min(1, k));
  const ch = (x: number, y: number) => Math.round(x + (y - x) * q);
  return `rgb(${ch(ca[0], cb[0])}, ${ch(ca[1], cb[1])}, ${ch(ca[2], cb[2])})`;
}

const num = (v: unknown, fallback: number): number => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
};

/**
 * Every dot of the layer at one moment. `values` is the layer's resolved properties (so an
 * animated `m`, `radius` or `count` arrives already interpolated). A dot whose x or y formula
 * gives no number is left out; a broken radius / opacity / mix formula falls back to the plain
 * property, so one typo dims nothing and hides nothing.
 */
export function computeDots(
  values: Record<string, unknown>,
  box: DotFieldBox,
  time: number,
  amp: DotFieldAmp = { amp: 0, ampL: 0, ampR: 0 },
): Dot[] {
  const fx = compileDotFormula(values.xFormula);
  const fy = compileDotFormula(values.yFormula);
  if (!fx || !fy) return [];

  const n = Math.max(1, Math.min(DOT_FIELD_MAX_COUNT, Math.round(num(values.count, DOT_FIELD_DEFAULT_COUNT))));
  const radius = Math.max(0, num(values.radius, DOT_FIELD_DEFAULT_RADIUS));
  const color = typeof values.color === 'string' && values.color ? values.color : DOT_FIELD_DEFAULT_COLOR;
  const color2 = typeof values.color2 === 'string' && values.color2 ? values.color2 : null;
  const fr = compileDotFormula(values.radiusFormula);
  const fo = compileDotFormula(values.opacityFormula);
  const fm = color2 ? compileDotFormula(values.mixFormula) : null;

  const base: Omit<RunCtx, 'i'> = {
    ...box, ...amp, n, time,
    m: num(values.m, 0),
    r: radius,
    seed: num(values.seed, 1),
    tStart: num(values.tStart, 0),
    // `?? 2π`, not `|| 2π`: a sweep that ends at exactly 0 is a legitimate choice.
    tEnd: values.tEnd === undefined || values.tEnd === null ? Math.PI * 2 : num(values.tEnd, Math.PI * 2),
  };

  const dots: Dot[] = [];
  for (let i = 0; i < n; i += 1) {
    const c: RunCtx = { ...base, i };
    const x = run(fx, c);
    const y = run(fy, c);
    if (x === null || y === null) continue;
    const r = fr ? run(fr, c) ?? radius : radius;
    const alpha = fo ? run(fo, c) ?? 1 : 1;
    if (!(r > 0) || !(alpha > 0)) continue;
    const k = fm ? run(fm, c) ?? 0 : 0;
    dots.push({ x, y, r, alpha: Math.min(1, alpha), color: color2 && k > 0 ? mixColors(color, color2, k) : color });
  }
  return dots;
}

// ── Ready-made layouts ──────────────────────────────────────────────────────
// Written against the layer box (x0, y0, w, h) so a layout follows the box when it is moved,
// resized or refitted — the same rule as the math-shape curve presets.

// Columns of a grid that fills the box: about sqrt(n · w/h), at least 1.
const COLS = 'max(1, floor(sqrt(n*w/h) + 0.5))';
const ROWS = `floor((n + ${COLS} - 1) / ${COLS})`;
const GRID_X = `x0 + (i % ${COLS} + 0.5) * w / ${COLS}`;
const GRID_Y = `y0 + (floor(i / ${COLS}) + 0.5) * h / ${ROWS}`;
const SUN_X = 'x0 + w/2 + min(w,h)*0.48*sqrt((i+0.5)/n)*cos(i*2.39996)';
const SUN_Y = 'y0 + h/2 + min(w,h)*0.48*sqrt((i+0.5)/n)*sin(i*2.39996)';
const slide = (a: string, b: string) => `(${a}) + ((${b}) - (${a})) * smooth(0, 1, m)`;

export type DotFieldPreset = {
  id: string;
  label: string;
  summary: string;
  properties: {
    xFormula: string;
    yFormula: string;
    radiusFormula?: string;
    opacityFormula?: string;
    mixFormula?: string;
  };
};

export const DOT_FIELD_PRESETS: DotFieldPreset[] = [
  {
    id: 'sunflower',
    label: 'Sunflower (one body)',
    summary: 'Dots packed evenly in a disc, the way seeds sit in a sunflower.',
    properties: { xFormula: SUN_X, yFormula: SUN_Y },
  },
  {
    id: 'sunflower-breathing',
    label: 'Sunflower, breathing',
    summary: 'The same body, expanding and contracting every six seconds, each dot pulsing on its own.',
    properties: {
      xFormula: 'x0 + w/2 + min(w,h)*0.48*sqrt((i+0.5)/n)*cos(i*2.39996)*(1 + 0.06*sin(time*pi/3))',
      yFormula: 'y0 + h/2 + min(w,h)*0.48*sqrt((i+0.5)/n)*sin(i*2.39996)*(1 + 0.06*sin(time*pi/3))',
      radiusFormula: 'r * (1 + 0.22*sin(time*1.3 + rnd*2*pi))',
    },
  },
  {
    id: 'grid',
    label: 'Grid',
    summary: 'Rows and columns that fill the box.',
    properties: { xFormula: GRID_X, yFormula: GRID_Y },
  },
  {
    id: 'grid-appear',
    label: 'Grid, appearing column by column',
    summary: 'The grid fills in from left to right over the first seconds.',
    properties: { xFormula: GRID_X, yFormula: GRID_Y, opacityFormula: `smooth(0, 0.6, time - (i % ${COLS}) * 0.12)` },
  },
  {
    id: 'grid-to-sunflower',
    label: 'Grid → sunflower (animate m)',
    summary: 'Keyframe the layer property m from 0 to 1: the grid gathers into one body.',
    properties: { xFormula: slide(GRID_X, SUN_X), yFormula: slide(GRID_Y, SUN_Y), mixFormula: 'smooth(0, 1, m) * rnd' },
  },
  {
    id: 'ring',
    label: 'Ring',
    summary: 'Dots evenly around a circle.',
    properties: { xFormula: 'x0 + w/2 + min(w,h)*0.45*cos(2*pi*u)', yFormula: 'y0 + h/2 + min(w,h)*0.45*sin(2*pi*u)' },
  },
  {
    id: 'cluster',
    label: 'Cluster (scattered)',
    summary: 'A loose, natural-looking group. Change seed for another arrangement.',
    properties: { xFormula: 'x0 + w/2 + w*0.48*sqrt(rnd)*cos(2*pi*rnd2)', yFormula: 'y0 + h/2 + h*0.48*sqrt(rnd)*sin(2*pi*rnd2)' },
  },
  {
    id: 'wave',
    label: 'Wave',
    summary: 'A line of dots that rolls like water.',
    properties: { xFormula: 'x0 + p*w', yFormula: 'y0 + h/2 + h*0.35*sin(2*pi*p*2 - time*2)' },
  },
  {
    id: 'heartbeat',
    label: 'Sunflower, heartbeat',
    summary: 'Two soft beats every 1.5 seconds, all dots together.',
    properties: {
      xFormula: SUN_X,
      yFormula: SUN_Y,
      radiusFormula: 'r * (1 + 0.35*pow(2.71828, -pow((time % 1.5 - 0.10)/0.06, 2)) + 0.2*pow(2.71828, -pow((time % 1.5 - 0.38)/0.07, 2)))',
    },
  },
];
