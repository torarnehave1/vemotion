import React, { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import { suggestCaption } from '../lib/cloud-compositions';

const IG_CAPTION_MAX = 2200;

interface CaptionFieldProps {
  composition: CompositionData;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

/**
 * Instagram caption box with an AI draft button, shared by the carousel and
 * Reel post modals (Lesson 22 — one copy, not two).
 *
 * "Suggest with AI" calls `/vemotion/suggest-caption` (Claude Haiku 4.5 behind
 * the worker), which writes in the composition's own language and returns at
 * most 5 hashtags — Blotato's Instagram ceiling, enforced server-side by
 * trimming, not merely requested in the prompt. A suggestion REPLACES the box,
 * so anything already typed is offered back via Undo rather than lost.
 */
export const CaptionField: React.FC<CaptionFieldProps> = ({ composition, value, onChange, disabled }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  const [previous, setPrevious] = useState<string | null>(null);

  const suggest = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const r = await suggestCaption(composition);
      setPrevious(value);
      setDropped(r.hashtagsDropped);
      onChange(r.caption);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const undo = () => {
    if (previous === null) return;
    onChange(previous);
    setPrevious(null);
    setDropped([]);
  };

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1 gap-2">
        <label className="text-xs text-slate-500 dark:text-slate-400">Caption</label>
        <div className="flex items-center gap-2">
          {previous !== null && !busy && (
            <button
              type="button"
              onClick={undo}
              disabled={disabled}
              className="text-[10px] text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 underline disabled:opacity-40"
            >
              Undo
            </button>
          )}
          <button
            type="button"
            onClick={suggest}
            disabled={disabled || busy}
            title="Draft a caption with Claude Haiku (max 5 hashtags)"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-sky-500/10 text-sky-500 hover:bg-sky-500/20 disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {busy ? 'Writing…' : 'Suggest with AI'}
          </button>
          <span className={`text-[10px] ${value.length > IG_CAPTION_MAX ? 'text-red-400' : 'text-slate-400'}`}>
            {value.length}/{IG_CAPTION_MAX}
          </span>
        </div>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={4}
        placeholder="Write your Instagram caption…"
        className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-y"
      />
      {dropped.length > 0 && (
        <p className="mt-1 text-[10px] text-amber-500">
          Trimmed to 5 hashtags for Instagram — dropped {dropped.join(' ')}
        </p>
      )}
      {error && <p className="mt-1 text-[10px] text-red-400 break-words">{error}</p>}
    </div>
  );
};
