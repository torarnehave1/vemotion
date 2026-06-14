import React, { useState } from 'react';
import type { CompositionData, Layer } from '../lib/api';

/**
 * Path stream controls. Shown in the sidebar when a `path` layer (or one of its
 * follower dots) is selected. Lets the author set the stream's colour, speed
 * (seconds per traversal), density (number of phase-offset dots), and start/stop
 * window without hand-editing JSON or hitting the API. Applies via onApply,
 * which rebuilds the path + all its follower dots in one composition update.
 *
 * Remounted per path (keyed on pathId by the parent), so local state always
 * initialises from the selected path's current settings.
 */

export interface StreamSettings {
  color: string;
  cycle: number;   // seconds per traversal (lower = faster)
  density: number; // number of dots in the stream
  start: number;   // window start (s)
  end: number;     // window end (s)
}

interface Props {
  pathId: string;
  settings: StreamSettings;
  onApply: (s: StreamSettings) => void;
}

const num = (v: string, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const PathStreamPanel: React.FC<Props> = ({ pathId, settings, onApply }) => {
  const [s, setS] = useState<StreamSettings>(settings);
  const set = (patch: Partial<StreamSettings>) => setS((prev) => ({ ...prev, ...patch }));

  const field = 'w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-sky-500';
  const label = 'block text-xs text-slate-400 mb-1';

  return (
    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900 p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-slate-100">Path stream</h3>
        <span className="text-[11px] text-slate-500 truncate max-w-[120px]" title={pathId}>{pathId}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={label}>Colour</label>
          <div className="flex items-center gap-2">
            <input type="color" value={s.color} onChange={(e) => set({ color: e.target.value })}
              className="h-8 w-10 rounded border border-slate-700 bg-slate-800 p-0.5" aria-label="Stream colour" />
            <input type="text" value={s.color} onChange={(e) => set({ color: e.target.value })} className={field} />
          </div>
        </div>

        <div>
          <label className={label}>Speed (s / loop)</label>
          <input type="number" step="0.1" min="0.1" value={s.cycle}
            onChange={(e) => set({ cycle: Math.max(0.1, num(e.target.value, s.cycle)) })} className={field} />
        </div>
        <div>
          <label className={label}>Density (dots)</label>
          <input type="number" step="1" min="1" max="12" value={s.density}
            onChange={(e) => set({ density: Math.max(1, Math.min(12, Math.round(num(e.target.value, s.density)))) })} className={field} />
        </div>

        <div>
          <label className={label}>Start (s)</label>
          <input type="number" step="0.1" min="0" value={s.start}
            onChange={(e) => set({ start: Math.max(0, num(e.target.value, s.start)) })} className={field} />
        </div>
        <div>
          <label className={label}>Stop (s)</label>
          <input type="number" step="0.1" value={s.end}
            onChange={(e) => set({ end: num(e.target.value, s.end) })} className={field} />
        </div>
      </div>

      <button
        onClick={() => onApply({ ...s, end: Math.max(s.start + 0.5, s.end) })}
        className="mt-3 w-full rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-2 text-sm font-medium text-white transition"
      >
        Apply to stream
      </button>
      <p className="mt-2 text-[11px] text-slate-500">Rebuilds the path + its dots: {s.density} dot{s.density === 1 ? '' : 's'}, looping every {s.cycle}s, from {s.start}s to {Math.max(s.start + 0.5, s.end)}s.</p>
    </div>
  );
};

// Resolve the selected layer to its path + current stream settings. A path
// resolves to itself; a follower dot resolves to the path its motionScenes
// reference. Returns null when the selection isn't a path/stream.
export function resolveStreamPath(comp: CompositionData, selId: string | null): { pathId: string; settings: StreamSettings } | null {
  if (!selId) return null;
  const sel = comp.layers.find((l) => l.id === selId);
  if (!sel) return null;
  const msOf = (l: Layer) => ((l.properties as Record<string, unknown>)?.motionScenes as Array<{ pathLayerId?: string; start?: number; end?: number }>) || [];
  let pathId: string | null = null;
  if (sel.type === 'path') pathId = sel.id;
  else if (sel.type === 'shape') pathId = msOf(sel).map((s) => s?.pathLayerId).find(Boolean) ?? null;
  if (!pathId) return null;
  const path = comp.layers.find((l) => l.id === pathId && l.type === 'path');
  if (!path) return null;
  const dots = comp.layers.filter((l) => l.type === 'shape' && msOf(l).some((s) => s?.pathLayerId === pathId));
  const primary = dots[0];
  const scenes = primary ? msOf(primary) : [];
  const cycle = scenes[0] ? +(((scenes[0].end ?? 0) - (scenes[0].start ?? 0)).toFixed(2)) : 0.8;
  const start = +((primary?.startTime ?? path.startTime ?? 0).toFixed(2));
  const dur = primary?.layerDuration ?? path.layerDuration ?? comp.duration;
  const end = +((start + dur).toFixed(2));
  const color = ((path.properties as Record<string, unknown>)?.strokeColor as string)
    || ((primary?.properties as Record<string, unknown>)?.color as string) || '#38bdf8';
  return { pathId, settings: { color, cycle: cycle || 0.8, density: Math.max(1, dots.length || 1), start, end } };
}
