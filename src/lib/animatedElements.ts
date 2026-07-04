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

export type ElementId = 'ripple';

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
];
