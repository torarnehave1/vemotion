import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import { refitComposition, type RefitMode } from '../lib/refit';

interface RefitCompositionModalProps {
  composition: CompositionData;
  onApply: (next: CompositionData) => void;
  onClose: () => void;
}

const SIZE_PRESETS = [
  { label: 'YouTube / Landscape HD — 1920×1080', w: 1920, h: 1080 },
  { label: 'YouTube Short / Reels / TikTok — 1080×1920', w: 1080, h: 1920 },
  { label: 'Instagram Square — 1080×1080', w: 1080, h: 1080 },
  { label: 'Instagram Landscape — 1280×720', w: 1280, h: 720 },
  { label: 'Custom', w: 0, h: 0 },
] as const;

const MODES: { value: RefitMode; label: string; hint: string }[] = [
  {
    value: 'fill',
    label: 'Fill (cover)',
    hint: 'Uniform scale; the composition fills the new frame. May clip on the shorter axis. Most natural for full-bleed compositions.',
  },
  {
    value: 'fit',
    label: 'Fit (letterbox)',
    hint: 'Uniform scale; the entire composition fits inside the new frame. Leaves bars on the longer axis. Preserves every layer untouched.',
  },
  {
    value: 'stretch',
    label: 'Stretch',
    hint: 'Independent x/y scale; no bars, no clipping. Distorts circles into ellipses and stretches text.',
  },
];

/**
 * "Refit layers to canvas" modal. Picks a target canvas size + scaling mode
 * and applies refitComposition() to produce a new composition whose layers
 * have been scaled to suit the new aspect.
 *
 * Source canvas size = the composition's current width/height (shown
 * read-only as From). Layers are scaled FROM that size TO the chosen target.
 */
export const RefitCompositionModal: React.FC<RefitCompositionModalProps> = ({
  composition,
  onApply,
  onClose,
}) => {
  // Default the target to the current size so nothing changes if the user
  // just hits Apply. They must explicitly pick a new preset or edit W/H.
  const matchingPreset = SIZE_PRESETS.find(p => p.w === composition.width && p.h === composition.height);
  const [presetLabel, setPresetLabel] = useState<string>(matchingPreset?.label ?? 'Custom');
  const [targetW, setTargetW] = useState<number>(composition.width);
  const [targetH, setTargetH] = useState<number>(composition.height);
  const [mode, setMode] = useState<RefitMode>('fill');

  const handlePresetChange = (label: string) => {
    setPresetLabel(label);
    const preset = SIZE_PRESETS.find(p => p.label === label);
    if (preset && preset.w !== 0) {
      setTargetW(preset.w);
      setTargetH(preset.h);
    }
  };

  const handleApply = () => {
    if (targetW <= 0 || targetH <= 0) return;
    const next = refitComposition(composition, targetW, targetH, mode);
    onApply(next);
    onClose();
  };

  const noChange = targetW === composition.width && targetH === composition.height;

  const aspectFrom = useMemo(() => formatAspect(composition.width, composition.height), [composition.width, composition.height]);
  const aspectTo = useMemo(() => formatAspect(targetW, targetH), [targetW, targetH]);

  const modeHint = MODES.find(m => m.value === mode)?.hint;

  // createPortal escapes the transform ancestor on <aside> in Dashboard
  // (Tailwind `translate-x-0` makes the sidebar a containing block for
  // position:fixed descendants — without the portal the modal renders
  // inside the sidebar bounds instead of centred on the viewport).
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200">Refit layers to canvas</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">From (current)</label>
            <div className="text-sm text-slate-200 font-mono bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
              {composition.width} × {composition.height} <span className="text-slate-500">({aspectFrom})</span>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">To (target preset)</label>
            <select
              value={presetLabel}
              onChange={e => handlePresetChange(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {SIZE_PRESETS.map(p => (
                <option key={p.label} value={p.label}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Width (px)</label>
              <input
                type="number"
                min={100}
                max={3840}
                value={targetW}
                onChange={e => {
                  setTargetW(parseInt(e.target.value) || targetW);
                  setPresetLabel('Custom');
                }}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Height (px)</label>
              <input
                type="number"
                min={100}
                max={3840}
                value={targetH}
                onChange={e => {
                  setTargetH(parseInt(e.target.value) || targetH);
                  setPresetLabel('Custom');
                }}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">Mode</label>
            <select
              value={mode}
              onChange={e => setMode(e.target.value as RefitMode)}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {MODES.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            {modeHint && <p className="text-xs text-slate-500 mt-1.5">{modeHint}</p>}
          </div>

          <div className="text-xs text-slate-500 border-t border-slate-800 pt-3 space-y-1">
            <p>
              <span className="text-slate-400">Layers affected:</span> {composition.layers.length}
            </p>
            <p>
              <span className="text-slate-400">Target aspect:</span> {aspectTo}
            </p>
            <p className="text-slate-600">
              Note: math-shape <code>xFormula</code> / <code>yFormula</code> with hard-coded
              pixel constants (e.g. <code>t * 60</code>) don&apos;t auto-scale. Same for
              <code> motionScenes</code> formulas. Edit those by hand if needed.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={noChange || targetW <= 0 || targetH <= 0}
            className="px-3 py-1.5 text-xs font-medium rounded-lg transition bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white"
            title={noChange ? 'Pick a different target size first' : 'Apply refit'}
          >
            Apply refit
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

function formatAspect(w: number, h: number): string {
  if (w <= 0 || h <= 0) return '—';
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
