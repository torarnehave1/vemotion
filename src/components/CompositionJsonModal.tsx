import React, { useEffect, useMemo, useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import type { CompositionData } from '../lib/api';

interface CompositionJsonModalProps {
  composition: CompositionData;
  onClose: () => void;
}

/**
 * Read-only modal that pretty-prints the current composition as JSON
 * and offers a one-click copy to clipboard. The view is the renderer-eaten
 * artifact only — no id, name, or cloud metadata. To round-trip changes
 * back into the app, use the existing File → Save / Load entries.
 */
export const CompositionJsonModal: React.FC<CompositionJsonModalProps> = ({ composition, onClose }) => {
  const json = useMemo(() => JSON.stringify(composition, null, 2), [composition]);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
      } else {
        // Fallback for insecure contexts / very old browsers
        const ta = document.createElement('textarea');
        ta.value = json;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 2000);
    }
  };

  const layerCount = composition.layers?.length ?? 0;
  const sizeKB = (new Blob([json]).size / 1024).toFixed(1);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-semibold text-slate-200">Composition JSON</h2>
            <span className="text-xs text-slate-500">
              {layerCount} layer{layerCount === 1 ? '' : 's'} · {sizeKB} KB
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-slate-950">
          <pre className="text-xs text-slate-200 font-mono p-4 whitespace-pre leading-relaxed">{json}</pre>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-800">
          <span className="text-xs text-slate-500">Read-only. To edit, use File → Save / Load.</span>
          <div className="flex items-center gap-2">
            <button
              onClick={copy}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition',
                copyState === 'copied'
                  ? 'bg-emerald-600 text-white'
                  : copyState === 'error'
                  ? 'bg-red-600 text-white'
                  : 'bg-sky-600 hover:bg-sky-500 text-white',
              ].join(' ')}
            >
              {copyState === 'copied' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy JSON'}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
