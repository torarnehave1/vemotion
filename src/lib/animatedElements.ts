import type { Layer, Animation, LayerGroup } from './api';

// ── Built-in animated elements ──────────────────────────────────────────────
//
// An "animated element" is a self-contained cluster of layers that renders a
// recognisable motion (a water-drop ripple, a pulse, …) with zero further
// configuration. Each generator returns a `Layer[]` ready to drop straight onto
// the composition via CompositionEditor.addLayers — matching how applyPathStream
// (Dashboard.tsx) builds a staggered shape cluster.
//
// These are deterministic code generators, not KG-interpreted definitions
// (lessons_learned L43): the geometry/timing is computed here, identically every
// run, and is verifiable in isolation. New elements are one registry entry each.

/** Context handed to every element generator at insert time. */
export interface ElementContext {
  compositionWidth: number;
  compositionHeight: number;
  compositionDuration: number;
  /** Absolute composition time (s) the cluster should start at. Default 0. */
  startTime?: number;
}

export type ElementId = 'ripple' | 'pulse' | 'orbit';

let elCounter = 0;
function elId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(elCounter++).toString(36)}`;
}

// ── Water-drop / ripple ─────────────────────────────────────────────────────

export interface RippleOpts {
  /** Ring centre in canvas px. */
  center: { x: number; y: number };
  /** Ring + drop colour. */
  color: string;
  /** Number of concurrent phase-offset ring "slots" (a higher count = denser stream). */
  ringCount: number;
  /** Lifetime of a single ring: grow + fade, in seconds. */
  ringLife: number;
  /** Ring diameter at full expansion, in px (= the ring layer's base size). */
  finalDiameter: number;
  /** Ring outline width in px at full size. */
  strokeWidth: number;
  /** When the whole cluster starts, in seconds. */
  start: number;
  /** How long the cluster keeps emitting, in seconds. */
  duration: number;
  /** Group id stamped on every layer so the cluster moves/recolours as one. */
  groupId?: string;
}

const RIPPLE_DEFAULTS: Omit<RippleOpts, 'center'> = {
  color: '#38bdf8',
  ringCount: 4,
  ringLife: 1.8,
  finalDiameter: 280,
  strokeWidth: 3,
  start: 0,
  duration: 6,
};

/**
 * Build the keyframes for one ripple ring "slot": a value that repeats a
 * grow/fade cycle every `ringLife` seconds across `dur` seconds of layer-local
 * time. `from`→`to` is applied within each cycle; a reset keyframe an epsilon
 * before each cycle boundary snaps the value back so the next ring starts fresh
 * (keyframe interpolation clamps at boundaries — it does not loop on its own).
 */
function cyclicKeyframes(from: number, to: number, ringLife: number, dur: number): { time: number; value: number }[] {
  const EPS = 0.001;
  const kfs: { time: number; value: number }[] = [];
  const cycles = Math.max(1, Math.ceil(dur / ringLife));
  for (let c = 0; c < cycles; c += 1) {
    const t0 = c * ringLife;
    if (t0 >= dur) break;
    kfs.push({ time: +t0.toFixed(3), value: from });
    const tEnd = Math.min(t0 + ringLife, dur);
    kfs.push({ time: +(tEnd - EPS).toFixed(3), value: to });
  }
  return kfs;
}

/**
 * Keyframes for a value that beats base → peak → base every `period` seconds
 * across `dur`. Unlike cyclicKeyframes the reset needs no epsilon: the trough
 * value is identical at each cycle boundary, so consecutive cycles share it.
 */
function pulseKeyframes(base: number, peak: number, period: number, dur: number): { time: number; value: number }[] {
  const kfs: { time: number; value: number }[] = [];
  for (let t = 0; t < dur - 1e-6; t += period) {
    kfs.push({ time: +t.toFixed(3), value: base });
    kfs.push({ time: +Math.min(t + period / 2, dur).toFixed(3), value: peak });
  }
  kfs.push({ time: +dur.toFixed(3), value: base });
  return kfs;
}

// ── Pulse / beacon ──────────────────────────────────────────────────────────

export interface PulseOpts {
  center: { x: number; y: number };
  color: string;
  /** Core dot diameter in px (the ring sits ~1.6× larger). */
  coreDiameter: number;
  /** Seconds per beat. */
  period: number;
  start: number;
  duration: number;
  groupId?: string;
}

const PULSE_DEFAULTS: Omit<PulseOpts, 'center'> = {
  color: '#f43f5e',
  coreDiameter: 60,
  period: 1.1,
  start: 0,
  duration: 6,
};

export function buildPulse(input: Partial<PulseOpts> & { center: { x: number; y: number } }): Layer[] {
  const o: PulseOpts = { ...PULSE_DEFAULTS, ...input };
  const period = Math.max(0.2, o.period);
  const core = Math.max(8, o.coreDiameter);
  const ring = Math.round(core * 1.7);
  const start = Math.max(0, o.start);
  const duration = Math.max(period, o.duration);
  const groupId = o.groupId;
  const at = (size: number) => ({ x: Math.round(o.center.x - size / 2), y: Math.round(o.center.y - size / 2) });

  return [
    // Outer ring — beats a touch larger + fades, giving the "sonar" halo.
    {
      id: elId('pulse-ring'), type: 'shape', name: 'Pulse halo', groupId,
      position: at(ring), size: { width: ring, height: ring },
      startTime: +start.toFixed(2), layerDuration: +duration.toFixed(2),
      properties: { shape: 'circle', filled: false, color: o.color, strokeColor: o.color, strokeWidth: 3, opacity: 0.55 },
      animation: { property: 'scale', easing: 'easeInOut', keyframes: pulseKeyframes(0.9, 1.25, period, duration) } as Animation,
      animations: [{ property: 'opacity', easing: 'easeInOut', keyframes: pulseKeyframes(0.55, 0.15, period, duration) } as Animation],
    },
    // Core dot — the beacon itself.
    {
      id: elId('pulse-core'), type: 'shape', name: 'Pulse core', groupId,
      position: at(core), size: { width: core, height: core },
      startTime: +start.toFixed(2), layerDuration: +duration.toFixed(2),
      properties: { shape: 'circle', color: o.color, opacity: 1 },
      animation: { property: 'scale', easing: 'easeInOut', keyframes: pulseKeyframes(1, 1.28, period, duration) } as Animation,
    },
  ];
}

// ── Orbit ───────────────────────────────────────────────────────────────────

export interface OrbitOpts {
  center: { x: number; y: number };
  color: string;
  /** Orbit radius in px. */
  radius: number;
  /** Number of dots evenly spaced around the orbit. */
  dotCount: number;
  /** Dot diameter in px. */
  dotDiameter: number;
  /** Seconds for one full revolution. */
  period: number;
  /** Draw the faint orbit track ring. */
  showTrack: boolean;
  start: number;
  duration: number;
  groupId?: string;
}

const ORBIT_DEFAULTS: Omit<OrbitOpts, 'center'> = {
  color: '#a78bfa',
  radius: 130,
  dotCount: 3,
  dotDiameter: 26,
  period: 3,
  showTrack: true,
  start: 0,
  duration: 6,
};

export function buildOrbit(input: Partial<OrbitOpts> & { center: { x: number; y: number } }): Layer[] {
  const o: OrbitOpts = { ...ORBIT_DEFAULTS, ...input };
  const R = Math.max(20, o.radius);
  const dotCount = Math.max(1, Math.min(12, Math.round(o.dotCount)));
  const dot = Math.max(6, o.dotDiameter);
  const W = (2 * Math.PI) / Math.max(0.3, o.period); // angular speed, rad/s
  const start = Math.max(0, o.start);
  const duration = Math.max(0.5, o.duration);
  const groupId = o.groupId;
  const layers: Layer[] = [];

  // Orbit track — a faint static stroke-only ring the dots ride on.
  if (o.showTrack) {
    const track = R * 2;
    layers.push({
      id: elId('orbit-track'), type: 'shape', name: 'Orbit track', groupId,
      position: { x: Math.round(o.center.x - R), y: Math.round(o.center.y - R) },
      size: { width: track, height: track },
      startTime: +start.toFixed(2), layerDuration: +duration.toFixed(2),
      properties: { shape: 'circle', filled: false, color: o.color, strokeColor: o.color, strokeWidth: 2, opacity: 0.35 },
    });
  }

  // Dots — each follows a circle via x/y formulas (renderer evaluates sin/cos on
  // layer-local `time`). Phase is baked into the formula so all share one scene.
  for (let j = 0; j < dotCount; j += 1) {
    const phase = ((2 * Math.PI) / dotCount) * j;
    const x0 = Math.round(o.center.x - dot / 2);
    const y0 = Math.round(o.center.y - dot / 2);
    const w = W.toFixed(4);
    const ph = phase.toFixed(4);
    layers.push({
      id: elId(`orbit-dot-${j}`), type: 'shape', name: j === 0 ? 'Orbit dot' : `Orbit dot ${j + 1}`, groupId,
      position: { x: x0, y: y0 },
      size: { width: dot, height: dot },
      startTime: +start.toFixed(2), layerDuration: +duration.toFixed(2),
      properties: {
        shape: 'circle', color: o.color, opacity: 1,
        motionScenes: [{
          start: 0, end: +duration.toFixed(2),
          xFormula: `x0 + ${R} * cos(time * ${w} + ${ph})`,
          yFormula: `y0 + ${R} * sin(time * ${w} + ${ph})`,
        }],
      },
    });
  }

  return layers;
}

export function buildRipple(input: Partial<RippleOpts> & { center: { x: number; y: number } }): Layer[] {
  const o: RippleOpts = { ...RIPPLE_DEFAULTS, ...input };
  const ringCount = Math.max(1, Math.min(8, Math.round(o.ringCount)));
  const ringLife = Math.max(0.3, o.ringLife);
  const size = Math.max(20, o.finalDiameter);
  const start = Math.max(0, o.start);
  const duration = Math.max(ringLife, o.duration);
  const halfPhase = ringLife / ringCount;
  const groupId = o.groupId;

  const layers: Layer[] = [];

  // Source "drop" — a small filled dot pulsing at the ring centre.
  const dotSize = 16;
  layers.push({
    id: elId('ripple-drop'),
    type: 'shape',
    name: 'Ripple source',
    groupId,
    position: { x: Math.round(o.center.x - dotSize / 2), y: Math.round(o.center.y - dotSize / 2) },
    size: { width: dotSize, height: dotSize },
    startTime: +start.toFixed(2),
    layerDuration: +duration.toFixed(2),
    properties: { shape: 'circle', color: o.color, opacity: 0.95 },
    animation: {
      property: 'scale',
      easing: 'easeOut',
      keyframes: cyclicKeyframes(1.4, 0.7, ringLife, duration),
    } as Animation,
  });

  // Ring slots — each phase-offset by ringLife/ringCount so the rings emit as a
  // continuous stream. Scale 0.06→1 grows the ring; opacity 1→0 fades it.
  for (let j = 0; j < ringCount; j += 1) {
    const st = +(start + j * halfPhase).toFixed(3);
    const dur = +(start + duration - st).toFixed(3);
    if (dur <= 0) continue;
    layers.push({
      id: elId(`ripple-ring-${j}`),
      type: 'shape',
      name: j === 0 ? 'Ripple ring' : `Ripple ring ${j + 1}`,
      groupId,
      position: { x: Math.round(o.center.x - size / 2), y: Math.round(o.center.y - size / 2) },
      size: { width: size, height: size },
      startTime: st,
      layerDuration: dur,
      properties: {
        shape: 'circle',
        filled: false,                 // stroke-only → a hollow ring (renderer drawShape)
        color: o.color,
        strokeColor: o.color,
        strokeWidth: o.strokeWidth,
        opacity: 1,
      },
      animation: {
        property: 'scale',
        easing: 'easeOut',
        keyframes: cyclicKeyframes(0.06, 1, ringLife, dur),
      } as Animation,
      animations: [
        {
          property: 'opacity',
          easing: 'easeIn',
          keyframes: cyclicKeyframes(1, 0, ringLife, dur),
        } as Animation,
      ],
    });
  }

  return layers;
}

// ── Registry ────────────────────────────────────────────────────────────────

export interface ElementCluster {
  /** The layers to append to the composition. Every layer shares `group.id`. */
  layers: Layer[];
  /** The group that wraps the cluster so it moves + recolours as one. */
  group: LayerGroup;
}

export interface AnimatedElement {
  id: ElementId;
  label: string;
  description: string;
  /** Emoji/badge shown on the card. */
  badge: string;
  build: (ctx: ElementContext) => ElementCluster;
}

export const ANIMATED_ELEMENTS: AnimatedElement[] = [
  {
    id: 'ripple',
    label: 'Water drop',
    description: 'A point that expands into rings, like a drop in water. Loops for the clip.',
    badge: '💧',
    build: (ctx) => {
      const groupId = elId('grp-ripple');
      const layers = buildRipple({
        center: { x: Math.round(ctx.compositionWidth / 2), y: Math.round(ctx.compositionHeight / 2) },
        start: ctx.startTime ?? 0,
        duration: Math.max(RIPPLE_DEFAULTS.ringLife, ctx.compositionDuration - (ctx.startTime ?? 0)),
        groupId,
      });
      return { layers, group: { id: groupId, name: 'Water drop', collapsed: false, visible: true } };
    },
  },
  {
    id: 'pulse',
    label: 'Pulse',
    description: 'A beacon dot that beats — pulses larger and back on a loop.',
    badge: '💓',
    build: (ctx) => {
      const groupId = elId('grp-pulse');
      const layers = buildPulse({
        center: { x: Math.round(ctx.compositionWidth / 2), y: Math.round(ctx.compositionHeight / 2) },
        start: ctx.startTime ?? 0,
        duration: Math.max(PULSE_DEFAULTS.period, ctx.compositionDuration - (ctx.startTime ?? 0)),
        groupId,
      });
      return { layers, group: { id: groupId, name: 'Pulse', collapsed: false, visible: true } };
    },
  },
  {
    id: 'orbit',
    label: 'Orbit',
    description: 'Dots circling a centre point on a faint track. Loops for the clip.',
    badge: '🪐',
    build: (ctx) => {
      const groupId = elId('grp-orbit');
      const layers = buildOrbit({
        center: { x: Math.round(ctx.compositionWidth / 2), y: Math.round(ctx.compositionHeight / 2) },
        start: ctx.startTime ?? 0,
        duration: Math.max(1, ctx.compositionDuration - (ctx.startTime ?? 0)),
        groupId,
      });
      return { layers, group: { id: groupId, name: 'Orbit', collapsed: false, visible: true } };
    },
  },
];
