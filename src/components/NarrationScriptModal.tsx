import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Paste-a-script importer for the teleprompter. Each line is one cue:
 * `time | text` (time = m:ss, h:mm:ss, or seconds). On Apply the raw text is
 * handed up; the parent rebuilds the hidden "Narration" group the teleprompter
 * reads. Portaled to document.body so a transform ancestor can't trap it (L19).
 */
interface Props {
  initialText: string;
  onApply: (raw: string) => void;
  onClose: () => void;
}

export const NarrationScriptModal: React.FC<Props> = ({ initialText, onApply, onClose }) => {
  const [text, setText] = useState(initialText);
  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}
      onMouseDown={onClose}
    >
      <div onMouseDown={(e) => e.stopPropagation()} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl w-[640px] max-w-[94vw]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-medium text-slate-100">Narration script</h3>
          <button onClick={onClose} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            One line per cue: <code className="text-slate-700 dark:text-slate-300">time | text</code> — e.g. <code className="text-slate-700 dark:text-slate-300">0:15 | It begins with the blueprint…</code>.
            Time can be <code className="text-slate-700 dark:text-slate-300">m:ss</code>, <code className="text-slate-700 dark:text-slate-300">h:mm:ss</code>, or seconds. Lines become a hidden "Narration" group the teleprompter reads.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            spellCheck={false}
            className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm text-slate-100 font-mono focus:outline-none focus:border-sky-500"
            placeholder={'0:03 | Every world starts as a blueprint…\n0:15 | It begins with the blueprint…\n0:21 | You own the infrastructure…'}
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-800">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-200 border border-slate-200 dark:border-slate-700">Cancel</button>
          <button onClick={() => { onApply(text); onClose(); }} className="px-4 py-2 rounded-lg text-sm font-medium bg-sky-600 hover:bg-sky-500 text-slate-900 dark:text-white">Apply script</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
