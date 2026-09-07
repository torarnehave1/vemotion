import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Instagram, AlertTriangle, ArrowLeft, Video } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import {
  renderVideoBlob,
  uploadVideoBlob,
  postInstagramVideo,
  type AccountPostResult,
} from '../lib/blotato';
import { useInstagramAccounts, InstagramAccountPicker, PostResultList } from './InstagramAccountPicker';

interface PostVideoModalProps {
  composition: CompositionData;
  onClose: () => void;
}

const IG_CAPTION_MAX = 2200;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'vemotion';
}

/**
 * "Post as Instagram video (Reel)" — two-step flow mirroring Instagram: STEP 1
 * render + WATCH the MP4 (the actual clip that will post), STEP 2 caption +
 * accounts, then Share. The clip is rendered once on open and the same blob is
 * uploaded at publish — no re-render. Several accounts may be selected: the
 * MP4 uploads once, then posts to each selected handle in turn. Publishing is
 * immediate and public.
 */
export const PostVideoModal: React.FC<PostVideoModalProps> = ({ composition, onClose }) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [renderMsg, setRenderMsg] = useState('Rendering MP4…');
  const [renderError, setRenderError] = useState<string | null>(null);

  const { accounts, accountsError, selectedIds, toggle, selectedAccounts } = useInstagramAccounts();
  const [caption, setCaption] = useState<string>(composition.meta?.description ?? '');

  const [phase, setPhase] = useState<'idle' | 'uploading' | 'posting'>('idle');
  const [publishProgress, setPublishProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AccountPostResult[] | null>(null);

  const urlRef = useRef<string>('');
  // True only when a mouse press STARTED on the backdrop itself — so a
  // textarea-resize drag that happens to release over the backdrop doesn't
  // close the modal (the click target is the backdrop, but the press wasn't).
  const backdropPressRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    renderVideoBlob(composition, (p) => { if (!cancelled) setRenderMsg(p.message || `Rendering… ${Math.round(p.percent)}%`); })
      .then((b) => {
        if (cancelled) return;
        const url = URL.createObjectURL(b);
        urlRef.current = url;
        setBlob(b);
        setPreviewUrl(url);
      })
      .catch((e) => { if (!cancelled) setRenderError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, [composition]);

  const busy = phase !== 'idle';
  const posted = results !== null;
  const rendering = blob === null && !renderError;

  const aspect = composition.height > 0 ? composition.width / composition.height : 0;
  const durationOk = composition.duration >= 3;
  const aspectHint = aspect >= 0.5 && aspect <= 1.92 ? null : 'Instagram may reject this aspect ratio for a Reel (expects ~9:16 to 1.91:1).';

  const handlePublish = async () => {
    if (busy || posted || !blob) return;
    setError(null);
    try {
      setPhase('uploading');
      setPublishProgress('Uploading video…');
      const fileBase = slugify(composition.meta?.carousel?.fileBase ?? caption.slice(0, 30));
      const videoUrl = await uploadVideoBlob(blob, fileBase);
      setPhase('posting');
      // The MP4 uploads ONCE; each selected account then gets its own Reel.
      const rs = await postInstagramVideo(selectedAccounts, videoUrl, caption, (done, total, username) =>
        setPublishProgress(`Publishing to @${username ?? ''} (${Math.min(done + 1, total)}/${total})…`),
      );
      setResults(rs);
      setPhase('idle');
      setPublishProgress('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
      setPublishProgress('');
    }
  };

  const title = posted ? 'Shared' : step === 1 ? 'Preview your video' : 'Caption and share';

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { backdropPressRef.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (!busy && e.target === e.currentTarget && backdropPressRef.current) onClose(); }}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          {step === 2 && !posted ? (
            <button onClick={() => setStep(1)} disabled={busy} className="p-1 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 disabled:opacity-40" title="Back to video">
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <span className="w-6 flex items-center"><Video className="w-4 h-4 text-slate-500" /></span>
          )}
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-200">{title}</h2>
          <button onClick={onClose} disabled={busy} className="p-1 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 disabled:opacity-40" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {posted && results ? (
            <PostResultList results={results} pendingNote="accepted — Instagram processes video first" />
          ) : step === 1 ? (
            <>
              <div className="relative bg-slate-950 rounded-lg overflow-hidden flex items-center justify-center" style={{ aspectRatio: `${composition.width} / ${composition.height}`, maxHeight: '52vh' }}>
                {rendering ? (
                  <div className="flex flex-col items-center justify-center gap-2 text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-xs text-center px-4">{renderMsg}</span>
                  </div>
                ) : renderError ? (
                  <div className="p-4 text-xs text-red-400 text-center">{renderError}</div>
                ) : (
                  <video src={previewUrl} controls playsInline className="w-full h-full object-contain" />
                )}
              </div>
              <p className="text-xs text-slate-500 text-center">
                {composition.width}×{composition.height} · {composition.duration}s · {composition.fps}fps
              </p>
              {!durationOk && (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-500"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> Instagram Reels must be at least 3 seconds — this is {composition.duration}s.</p>
              )}
              {aspectHint && (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-500"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {aspectHint}</p>
              )}
            </>
          ) : (
            <>
              <div className="flex gap-3 items-start">
                <div className="w-16 rounded-md overflow-hidden bg-slate-950 flex-shrink-0 flex items-center justify-center" style={{ aspectRatio: `${composition.width} / ${composition.height}` }}>
                  {previewUrl && <video src={previewUrl} muted className="w-full h-full object-contain" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-slate-500 dark:text-slate-400">Caption</label>
                    <span className={`text-[10px] ${caption.length > IG_CAPTION_MAX ? 'text-red-400' : 'text-slate-400'}`}>{caption.length}/{IG_CAPTION_MAX}</span>
                  </div>
                  <textarea
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    disabled={busy}
                    rows={4}
                    placeholder="Write your Instagram caption…"
                    className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-y"
                  />
                </div>
              </div>

              <InstagramAccountPicker
                accounts={accounts}
                error={accountsError}
                selectedIds={selectedIds}
                onToggle={toggle}
                disabled={busy}
              />

              <p className="flex items-start gap-1.5 text-[11px] text-amber-500">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> Publishing is immediate and public. The rendered MP4 uploads, then posts as a Reel
                {selectedIds.length > 1 ? ` to each of the ${selectedIds.length} selected accounts.` : '.'}
              </p>

              {error && <p className="text-xs text-red-400 break-words">{error}</p>}
              {busy && <p className="flex items-center gap-2 text-xs text-sky-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {publishProgress}</p>}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-200 dark:border-slate-800">
          <span className="text-[11px] text-slate-400">{posted ? '' : `Step ${step} of 2`}</span>
          <div className="flex items-center gap-2">
            {posted ? (
              <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">Close</button>
            ) : step === 1 ? (
              <>
                <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">Cancel</button>
                <button onClick={() => setStep(2)} disabled={rendering || !!renderError} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-500 text-white">Next</button>
              </>
            ) : (
              <>
                <button onClick={() => setStep(1)} disabled={busy} className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg disabled:opacity-40">Back</button>
                <button
                  onClick={handlePublish}
                  disabled={busy || selectedIds.length === 0 || !blob || caption.length > IG_CAPTION_MAX}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-fuchsia-600 to-orange-500 hover:from-fuchsia-500 hover:to-orange-400 disabled:from-slate-200 disabled:to-slate-200 dark:disabled:from-slate-700 dark:disabled:to-slate-700 disabled:text-slate-500 text-white flex items-center gap-1.5"
                >
                  {busy
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Publishing…</>
                    : <><Instagram className="w-3.5 h-3.5" /> Share Reel{selectedIds.length > 1 ? ` ×${selectedIds.length}` : ''}</>}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
