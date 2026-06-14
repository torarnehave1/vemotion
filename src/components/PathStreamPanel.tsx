import React, { useState } from 'react';

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
