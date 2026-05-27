import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, Save, AlertTriangle } from 'lucide-react';
import type { CompositionData } from '../lib/api';

interface CompositionJsonModalProps {
  composition: CompositionData;
  onClose: () => void;
  /**
   * Apply edited JSON back to the app. The modal performs JSON.parse and a
   * lightweight structural check (duration/fps/width/height numeric, layers
   * array) before calling this. Parent typically wires this to the same
   * setter used by File → Load — the autosave debounce will propagate to
   * cloud automatically.
   *
   * If omitted, the modal stays effectively read-only (no Save button).
   */
  onSave?: (composition: CompositionData) => void;
}

/**
 * View + edit the current composition as raw JSON. Editing happens in a
 * textarea seeded once from the composition at mount; the modal does NOT
 * re-sync from props during edit (so an autosave round-trip mid-edit can't
 * blow away the user's changes). On Save, the modal parses + structurally
 * validates the JSON and hands the result to `onSave`. Copy mirrors the
 * CURRENT edit state, not the original.
 *
 * Validation is intentionally minimal: top-level shape only. Layer-level
 * correctness is the renderer's job — feeding the result back through
 * setComposition lets the renderer surface any deeper issues on the next
 * frame. This preserves the "edit raw, see the result" loop the user
 * requested.
 */
export const CompositionJsonModal: React.FC<CompositionJsonModalProps> = ({ composition, onClose, onSave }) => {
  // Capture the initial JSON ONCE at mount — never re-derive from props.
  // If autosave (or any other source) mutates `composition` while the user
  // is editing, we keep their edits intact. The dirty check is against this
  // mount-time baseline.
  const [baseline] = useState(() => JSON.stringify(composition, null, 2));
  const [edited, setEdited] = useState(baseline);
  const [parseError, setParseError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [saving, setSaving] = useState(false);

  const dirty = edited !== baseline;

  // Esc closes (with confirm if dirty)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const handleClose = () => {
    if (dirty) {
      const ok = window.confirm('Discard unsaved JSON changes?');
      if (!ok) return;
    }
    onClose();
  };

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(edited);
      } else {
        const ta = document.createElement('textarea');
        ta.value = edited;
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

  const handleSave = () => {
    if (!onSave) return;
    setParseError(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(edited);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'invalid syntax';
      setParseError(`JSON parse error: ${msg}`);
      return;
    }

    // Minimal structural check — top-level shape only.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setParseError('Top-level must be a JSON object.');
      return;
    }
    const p = parsed as Record<string, unknown>;
    if (typeof p.duration !== 'number') return setParseError('Missing or invalid `duration` (must be a number).');
    if (typeof p.fps !== 'number') return setParseError('Missing or invalid `fps` (must be a number).');
    if (typeof p.width !== 'number') return setParseError('Missing or invalid `width` (must be a number).');
    if (typeof p.height !== 'number') return setParseError('Missing or invalid `height` (must be a number).');
    if (!Array.isArray(p.layers)) return setParseError('Missing or invalid `layers` (must be an array).');

    setSaving(true);
    try {
      onSave(parsed as CompositionData);
      // Parent applies the new composition; close the modal.
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error';
      setParseError(`Save failed: ${msg}`);
      setSaving(false);
    }
  };

  // Derive metrics from the CURRENT edited text. If JSON is malformed, fall
  // back to the byte size only — layer count is best-effort.
  let layerCount: number | null = null;
  try {
    const probe = JSON.parse(edited);
    if (probe && Array.isArray((probe as { layers?: unknown }).layers)) {
      layerCount = (probe as { layers: unknown[] }).layers.length;
    }
  } catch {
    layerCount = null;
  }
  const sizeKB = (new Blob([edited]).size / 1024).toFixed(1);

  // createPortal escapes the transform ancestor on <aside> in Dashboard
  // — same reason RefitCompositionModal and AddLayerModal use it. Without
  // the portal, position:fixed centres against the transform ancestor
  // (the sidebar) rather than the viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={handleClose}
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
              {layerCount !== null ? `${layerCount} layer${layerCount === 1 ? '' : 's'} · ` : ''}
              {sizeKB} KB
              {dirty && <span className="ml-2 text-amber-400">• edited</span>}
            </span>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — editable textarea */}
        <div className="flex-1 overflow-hidden bg-slate-950">
          <textarea
            value={edited}
            onChange={e => {
              setEdited(e.target.value);
              if (parseError) setParseError(null);
            }}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className="w-full h-full text-xs text-slate-200 font-mono p-4 bg-slate-950 outline-none resize-none leading-relaxed"
            style={{ whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto', minHeight: '50vh' }}
          />
        </div>

        {/* Parse error inline */}
        {parseError && (
          <div className="flex items-start gap-2 px-5 py-2 bg-red-950/40 border-t border-red-900 text-xs text-red-300">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span className="font-mono break-all">{parseError}</span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-800">
          <span className="text-xs text-slate-500">
            {onSave
              ? 'Edit the JSON directly. Save applies changes and triggers autosave.'
              : 'Read-only. To edit, use File → Save / Load.'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={copy}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition',
                copyState === 'copied'
                  ? 'bg-emerald-600 text-white'
                  : copyState === 'error'
                  ? 'bg-red-600 text-white'
                  : 'bg-slate-700 hover:bg-slate-600 text-white',
              ].join(' ')}
              title="Copy current JSON to clipboard"
            >
              {copyState === 'copied' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy'}
            </button>
            {onSave && (
              <button
                onClick={handleSave}
                disabled={!dirty || saving}
                className={[
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition',
                  dirty && !saving
                    ? 'bg-sky-600 hover:bg-sky-500 text-white'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed',
                ].join(' ')}
                title={dirty ? 'Apply edited JSON to the composition' : 'No changes to save'}
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Applying…' : 'Save'}
              </button>
            )}
            <button
              onClick={handleClose}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
