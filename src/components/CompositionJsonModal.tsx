import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, Save, AlertTriangle, Sparkles, Send, Loader2, ArrowDownToLine } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import { assistComposition, hasCloudToken, type AssistMessage } from '../lib/cloud-compositions';

/**
 * Extract the LAST fenced ```json ... ``` block from a message. The assistant
 * is instructed to return the FULL composition inside that block — the last
 * block wins in the rare case the model produces multiple.
 */
const extractJsonBlock = (content: string): string | null => {
  const re = /```json\s*\n([\s\S]*?)```/gi;
  let last: string | null = null;
  for (const m of content.matchAll(re)) {
    last = m[1].trim();
  }
  return last;
};

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

  // Assist panel state — independent from the textarea so toggling the
  // panel does not disturb the user's edits. The button is only rendered
  // when the user is signed in (assistComposition needs X-API-Token).
  const assistAvailable = hasCloudToken();
  const [showAssist, setShowAssist] = useState(false);
  const [chatMessages, setChatMessages] = useState<AssistMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const dirty = edited !== baseline;

  // Auto-scroll the chat to the latest message whenever it grows.
  useEffect(() => {
    if (!showAssist) return;
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatMessages, sending, showAssist]);

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

  // Parse the current textarea content; returns the parsed CompositionData
  // when the structural check passes, otherwise null. Used to attach the
  // current composition to assistant requests so the model can copy
  // unchanged fields verbatim.
  const parseCurrentComposition = (): CompositionData | null => {
    try {
      const parsed = JSON.parse(edited);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
      const p = parsed as Record<string, unknown>;
      if (typeof p.duration !== 'number') return null;
      if (typeof p.fps !== 'number') return null;
      if (typeof p.width !== 'number') return null;
      if (typeof p.height !== 'number') return null;
      if (!Array.isArray(p.layers)) return null;
      return parsed as CompositionData;
    } catch {
      return null;
    }
  };

  const sendChat = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || sending) return;
    setChatError(null);
    const nextHistory: AssistMessage[] = [...chatMessages, { role: 'user', content: trimmed }];
    setChatMessages(nextHistory);
    setChatInput('');
    setSending(true);
    try {
      const current = parseCurrentComposition() ?? undefined;
      const res = await assistComposition({ messages: nextHistory, composition: current });
      setChatMessages([...nextHistory, { role: 'assistant', content: res.message.content }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Assistant request failed.';
      setChatError(msg);
      // Roll back the optimistic user message so the user can retry without
      // a phantom message in the history.
      setChatMessages(chatMessages);
      setChatInput(trimmed);
    } finally {
      setSending(false);
    }
  };

  const applyJsonBlock = (block: string) => {
    // Pretty-print if it parses; otherwise drop the raw block in and let
    // the user's Save click surface any structural issue.
    try {
      const parsed = JSON.parse(block);
      setEdited(JSON.stringify(parsed, null, 2));
    } catch {
      setEdited(block);
    }
    setParseError(null);
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
        className={[
          'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-h-[85vh] flex flex-col overflow-hidden transition-[max-width] duration-150',
          showAssist ? 'max-w-6xl' : 'max-w-3xl',
        ].join(' ')}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-200">Composition JSON</h2>
            <span className="text-xs text-slate-500">
              {layerCount !== null ? `${layerCount} layer${layerCount === 1 ? '' : 's'} · ` : ''}
              {sizeKB} KB
              {dirty && <span className="ml-2 text-amber-400">• edited</span>}
            </span>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — editable textarea, with optional Assist side panel */}
        <div className="flex-1 flex overflow-hidden bg-white dark:bg-slate-950">
          <div className={['overflow-hidden', showAssist ? 'flex-1 min-w-0' : 'w-full'].join(' ')}>
            <textarea
              value={edited}
              onChange={e => {
                setEdited(e.target.value);
                if (parseError) setParseError(null);
              }}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="w-full h-full text-xs text-slate-900 dark:text-slate-200 font-mono p-4 bg-white dark:bg-slate-950 outline-none resize-none leading-relaxed"
              style={{ whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto', minHeight: '50vh' }}
            />
          </div>
          {showAssist && (
            <div className="w-[420px] flex-shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
              {/* Panel header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-200">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Assistant
                </div>
                <button
                  onClick={() => setShowAssist(false)}
                  className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  title="Hide assistant"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Message list */}
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {chatMessages.length === 0 && !sending && (
                  <div className="text-xs text-slate-500 leading-relaxed px-1">
                    Ask the assistant to change this composition. Examples:
                    <ul className="mt-2 space-y-1 list-disc list-inside text-slate-500 dark:text-slate-400">
                      <li>"Move the circle 100 pixels right."</li>
                      <li>"Add a title 'Hello' centered at the top."</li>
                      <li>"What does the scaleFormula field do?"</li>
                    </ul>
                    <div className="mt-3 text-slate-500">
                      Changes come back as a JSON block you can apply with one click. The current
                      JSON in the editor is sent along so the assistant edits exactly what you see.
                    </div>
                  </div>
                )}
                {chatMessages.map((m, i) => {
                  const block = m.role === 'assistant' ? extractJsonBlock(m.content) : null;
                  return (
                    <div
                      key={i}
                      className={[
                        'rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words',
                        m.role === 'user'
                          ? 'bg-sky-900/40 border border-sky-800 text-sky-100 ml-6'
                          : 'bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-200 mr-2',
                      ].join(' ')}
                    >
                      <div className="text-[10px] uppercase tracking-wide opacity-60 mb-1">
                        {m.role === 'user' ? 'You' : 'Assistant'}
                      </div>
                      <div className="font-sans">{m.content}</div>
                      {block && (
                        <button
                          onClick={() => applyJsonBlock(block)}
                          className="mt-2 flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-amber-600 hover:bg-amber-500 text-slate-900 dark:text-white transition"
                          title="Replace the JSON in the editor with this block. Click Save afterward to apply."
                        >
                          <ArrowDownToLine className="w-3 h-3" />
                          Apply to JSON
                        </button>
                      )}
                    </div>
                  );
                })}
                {sending && (
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 px-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Assistant is thinking…
                  </div>
                )}
                {chatError && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-red-950/40 border border-red-900 text-xs text-red-300">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span className="break-all">{chatError}</span>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="border-t border-slate-200 dark:border-slate-800 p-2.5">
                <div className="flex items-end gap-2">
                  <textarea
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void sendChat();
                      }
                    }}
                    placeholder="Ask the assistant…  (⌘/Ctrl+Enter to send)"
                    rows={2}
                    className="flex-1 text-xs text-slate-900 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md px-2.5 py-2 outline-none focus:border-amber-600 resize-none placeholder:text-slate-600"
                  />
                  <button
                    onClick={() => void sendChat()}
                    disabled={!chatInput.trim() || sending}
                    className={[
                      'p-2 rounded-md transition flex-shrink-0',
                      chatInput.trim() && !sending
                        ? 'bg-amber-600 hover:bg-amber-500 text-slate-900 dark:text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 cursor-not-allowed',
                    ].join(' ')}
                    title="Send (⌘/Ctrl+Enter)"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Parse error inline */}
        {parseError && (
          <div className="flex items-start gap-2 px-5 py-2 bg-red-950/40 border-t border-red-900 text-xs text-red-300">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span className="font-mono break-all">{parseError}</span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-200 dark:border-slate-800">
          <span className="text-xs text-slate-500">
            {onSave
              ? 'Edit the JSON directly. Save applies changes and triggers autosave.'
              : 'Read-only. To edit, use File → Save / Load.'}
          </span>
          <div className="flex items-center gap-2">
            {assistAvailable && (
              <button
                onClick={() => setShowAssist(s => !s)}
                className={[
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition',
                  showAssist
                    ? 'bg-amber-600 hover:bg-amber-500 text-slate-900 dark:text-white'
                    : 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 text-slate-900 dark:text-white',
                ].join(' ')}
                title={showAssist ? 'Hide AI assistant' : 'Open AI assistant'}
              >
                <Sparkles className="w-3.5 h-3.5" />
                {showAssist ? 'Assistant' : 'AI'}
              </button>
            )}
            <button
              onClick={copy}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition',
                copyState === 'copied'
                  ? 'bg-emerald-600 text-slate-900 dark:text-white'
                  : copyState === 'error'
                  ? 'bg-red-600 text-slate-900 dark:text-white'
                  : 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-600 text-slate-900 dark:text-white',
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
                    ? 'bg-sky-600 hover:bg-sky-500 text-slate-900 dark:text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 cursor-not-allowed',
                ].join(' ')}
                title={dirty ? 'Apply edited JSON to the composition' : 'No changes to save'}
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Applying…' : 'Save'}
              </button>
            )}
            <button
              onClick={handleClose}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
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
