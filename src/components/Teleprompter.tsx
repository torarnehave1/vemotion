import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Floating teleprompter overlay. Shows the narration line for the current
 * playhead on an OPAQUE panel pinned to the bottom of the viewport — an editor
 * overlay only, never part of the composition / export. Portaled to
 * document.body so a transform ancestor can't trap it (Lesson 19).
 */
interface Props {
  line: string | null;
  next: string | null;
  onClose: () => void;
}

export const Teleprompter: React.FC<Props> = ({ line, next, onClose }) => {
  return createPortal(
    <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 1000, width: 'min(900px, 92vw)' }}>
      <div className="rounded-xl border border-slate-700 shadow-2xl" style={{ background: 'rgba(7,11,20,0.97)' }}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
          <span className="text-[11px] uppercase tracking-wider text-sky-300">Teleprompter</span>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close teleprompter">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5">
          <p className="text-white" style={{ fontSize: 30, lineHeight: 1.35, fontWeight: 500, textAlign: 'center' }}>
            {line || '—'}
          </p>
          {next && (
            <p className="mt-3 text-slate-400" style={{ fontSize: 15, textAlign: 'center' }}>
              next: {next}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
