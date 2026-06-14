import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, GripHorizontal, Minus, Plus } from 'lucide-react';

/**
 * Floating, DRAGGABLE teleprompter overlay. Shows the narration line for the
 * current playhead on an OPAQUE panel — an editor overlay only, never part of
 * the composition / export. Portaled to document.body so a transform ancestor
 * can't trap it (Lesson 19). Drag the header to move it; A−/A+ resize the text.
 */
interface Props {
  line: string | null;
  next: string | null;
  onClose: () => void;
}

const W = 760;

export const Teleprompter: React.FC<Props> = ({ line, next, onClose }) => {
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: typeof window !== 'undefined' ? Math.max(8, (window.innerWidth - W) / 2) : 200,
    y: typeof window !== 'undefined' ? Math.max(8, window.innerHeight - 300) : 400,
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
            <button onPointerDown={stop} onClick={() => setFontSize((s) => Math.max(20, s - 4))} className="text-slate-400 hover:text-white p-1" aria-label="Smaller text"><Minus className="w-4 h-4" /></button>
            <span className="text-[11px] text-slate-500 w-8 text-center select-none">{fontSize}</span>
            <button onPointerDown={stop} onClick={() => setFontSize((s) => Math.min(110, s + 4))} className="text-slate-400 hover:text-white p-1" aria-label="Larger text"><Plus className="w-4 h-4" /></button>
            <button onPointerDown={stop} onClick={onClose} className="text-slate-400 hover:text-white p-1 ml-1" aria-label="Close teleprompter"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="px-6 py-5">
          <p className="text-white" style={{ fontSize, lineHeight: 1.3, fontWeight: 600, textAlign: 'center' }}>
            {line || '—'}
          </p>
          {next && (
            <p className="mt-3 text-slate-400" style={{ fontSize: Math.round(fontSize * 0.5), textAlign: 'center' }}>
              next: {next}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
