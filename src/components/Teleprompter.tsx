import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, GripHorizontal, Minus, Plus, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Floating, draggable teleprompter overlay. Shows the narration line for the
 * current playhead — and steps through the cues with Prev/Next WITHOUT playing
 * the composition (each step seeks the playhead to that cue's time). Editor
 * overlay only, never part of the export. Portaled to document.body (L19).
 */
interface Cue { time: number; text: string; }
interface Props {
  lines: Cue[];
  currentTime: number;
  onSeek: (time: number) => void;
  onClose: () => void;
}

const W = 760;

export const Teleprompter: React.FC<Props> = ({ lines, currentTime, onSeek, onClose }) => {
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: typeof window !== 'undefined' ? Math.max(8, (window.innerWidth - W) / 2) : 200,
    y: typeof window !== 'undefined' ? Math.max(8, window.innerHeight - 320) : 400,
  }));
  const [fontSize, setFontSize] = useState(48);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const onHeaderDown = (e: React.PointerEvent) => {
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPos({ x: d.ox + ev.clientX - d.sx, y: d.oy + ev.clientY - d.sy });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const stop = (e: React.PointerEvent) => e.stopPropagation();

  // Active = last cue at or before the playhead; -1 before the first cue.
  let active = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].time <= currentTime + 0.05) active = i; else break;
  }
  const cur = active >= 0 ? lines[active] : (lines[0] ?? null);
  const nextIdx = active < 0 ? 0 : active + 1;
  const nxt = lines[nextIdx] ?? null;

  const goPrev = () => { if (active > 0) onSeek(lines[active - 1].time); else if (active === 0) onSeek(lines[0].time); };
  const goNext = () => { if (nextIdx < lines.length) onSeek(lines[nextIdx].time); };
  const prevDisabled = active <= 0;
  const nextDisabled = nextIdx >= lines.length;

  const navBtn = (disabled: boolean) =>
    `p-1 rounded ${disabled ? 'text-slate-600 cursor-default' : 'text-slate-300 hover:text-white hover:bg-slate-800'}`;

  return createPortal(
    <div style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 1000, width: W, maxWidth: '96vw' }}>
      <div className="rounded-xl border border-slate-700 shadow-2xl" style={{ background: 'rgba(7,11,20,0.97)' }}>
        <div
          onPointerDown={onHeaderDown}
          className="flex items-center justify-between px-4 py-2 border-b border-slate-800 cursor-grab active:cursor-grabbing select-none"
        >
          <span className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-sky-300">
            <GripHorizontal className="w-4 h-4" /> Teleprompter
          </span>
          <div className="flex items-center gap-1">
            <button onPointerDown={stop} onClick={goPrev} disabled={prevDisabled} className={navBtn(prevDisabled)} aria-label="Previous line"><ChevronLeft className="w-5 h-5" /></button>
            <span className="text-[11px] text-slate-500 w-12 text-center select-none">{lines.length ? `${active < 0 ? 0 : active + 1}/${lines.length}` : '0/0'}</span>
            <button onPointerDown={stop} onClick={goNext} disabled={nextDisabled} className={navBtn(nextDisabled)} aria-label="Next line"><ChevronRight className="w-5 h-5" /></button>
            <span className="w-px h-5 bg-slate-700 mx-1" />
            <button onPointerDown={stop} onClick={() => setFontSize((s) => Math.max(20, s - 4))} className="text-slate-400 hover:text-white p-1" aria-label="Smaller text"><Minus className="w-4 h-4" /></button>
            <span className="text-[11px] text-slate-500 w-7 text-center select-none">{fontSize}</span>
            <button onPointerDown={stop} onClick={() => setFontSize((s) => Math.min(110, s + 4))} className="text-slate-400 hover:text-white p-1" aria-label="Larger text"><Plus className="w-4 h-4" /></button>
            <button onPointerDown={stop} onClick={onClose} className="text-slate-400 hover:text-white p-1 ml-1" aria-label="Close teleprompter"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="px-6 py-5">
          <p className="text-white" style={{ fontSize, lineHeight: 1.3, fontWeight: 600, textAlign: 'center' }}>
            {cur ? cur.text : '— no narration (add via Script) —'}
          </p>
          {nxt && (
            <p className="mt-3 text-slate-400" style={{ fontSize: Math.round(fontSize * 0.5), textAlign: 'center' }}>
              next: {nxt.text}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
