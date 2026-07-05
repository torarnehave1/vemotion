import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Instagram, ExternalLink, AlertTriangle, Video } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import {
  listInstagramAccounts,
  renderAndUploadVideo,
  postInstagramVideo,
  type BlotatoAccount,
} from '../lib/blotato';

interface PostVideoModalProps {
  composition: CompositionData;
  onClose: () => void;
}

const IG_CAPTION_MAX = 2200;

/** Pull a post id / permalink out of Blotato's response, if present. */
function extractPostUrl(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  for (const key of ['url', 'permalink', 'postUrl', 'link']) {
    if (typeof d[key] === 'string') return d[key] as string;
  }
  const submission = d.submission as Record<string, unknown> | undefined;
  if (submission && typeof submission.url === 'string') return submission.url;
  return null;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'vemotion';
}

/**
 * "Post as Instagram video (Reel)" modal. Renders the composition to MP4
 * (ffmpeg.wasm), uploads it to the public vemotion-video host, and publishes it
 * as an Instagram Reel through the blotato-worker (Blotato requires
 * target.mediaType 'reel' for Instagram video).
 *
 * Publishing is immediate and public, so the flow is two-step: review (account
 * + caption) → explicit Publish. No auto-post.
 */
export const PostVideoModal: React.FC<PostVideoModalProps> = ({ composition, onClose }) => {
  const [accounts, setAccounts] = useState<BlotatoAccount[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string>('');
  const [caption, setCaption] = useState<string>(composition.meta?.description ?? '');

  const [phase, setPhase] = useState<'idle' | 'rendering' | 'uploading' | 'posting' | 'done'>('idle');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listInstagramAccounts()
      .then((list) => {
        if (cancelled) return;
        setAccounts(list);
        const preferred = list.find((a) => a.username === 'tor.arne.have') ?? list[0];
        if (preferred) setAccountId(preferred.id);
      })
      .catch((e) => { if (!cancelled) setAccountsError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  const busy = phase === 'rendering' || phase === 'uploading' || phase === 'posting';

  // Reel spec sanity: min 3s duration; aspect within Instagram's supported band
  // (portrait 9:16 Reels through 1.91:1 landscape). Advisory only — not blocked.
  const aspect = composition.height > 0 ? composition.width / composition.height : 0;
  const durationOk = composition.duration >= 3;
  const aspectHint = aspect >= 0.5 && aspect <= 1.92 ? null
    : 'Instagram may reject this aspect ratio for a Reel (expects ~9:16 to 1.91:1).';

  const handlePublish = async () => {
    if (busy || posted) return;
    setError(null);
    try {
      const fileBase = slugify(composition.meta?.carousel?.fileBase ?? caption.slice(0, 30) ?? 'vemotion');
      setPhase('rendering');
      setProgress('Rendering MP4…');
      const videoUrl = await renderAndUploadVideo(
        composition,
        fileBase,
        (p) => {
          // exportToMp4's final stage is the upload happening inside
          // renderAndUploadVideo; surface the render stages here.
          setPhase('rendering');
          setProgress(p.message || `Rendering… ${Math.round(p.percent)}%`);
        },
      );
      setPhase('posting');
      setProgress('Publishing Reel to Instagram…');
      const result = await postInstagramVideo(accountId, videoUrl, caption);
      setResultUrl(extractPostUrl(result.data));
      setPosted(true);
      setPhase('done');
      setProgress('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
      setProgress('');
    }
  };

  const selectedAccount = accounts?.find((a) => a.id === accountId);

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-200 flex items-center gap-2">
            <Video className="w-4 h-4" /> Post as Instagram video (Reel)
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-40"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {posted ? (
            <div className="space-y-3">
              <p className="text-sm text-emerald-500 font-medium">
                Reel published to {selectedAccount ? `@${selectedAccount.username}` : 'Instagram'}.
              </p>
              {resultUrl ? (
                <a
                  href={resultUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-sky-500 hover:text-sky-400 underline"
                >
                  View on Instagram <ExternalLink className="w-3.5 h-3.5" />
                </a>
              ) : (
                <p className="text-xs text-slate-500">
                  Blotato accepted the post. Instagram processes video before it appears — this can take a few minutes.
                </p>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Instagram account</label>
                {accountsError ? (
                  <p className="text-xs text-red-400">{accountsError}</p>
                ) : accounts === null ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading accounts…
                  </div>
                ) : accounts.length === 0 ? (
                  <p className="text-xs text-amber-500">No Instagram account is connected in Blotato.</p>
                ) : (
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    disabled={busy}
                    className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        @{a.username}{a.fullname ? ` — ${a.fullname}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-500 dark:text-slate-400">Caption</label>
                  <span className={`text-[10px] ${caption.length > IG_CAPTION_MAX ? 'text-red-400' : 'text-slate-400'}`}>
                    {caption.length}/{IG_CAPTION_MAX}
                  </span>
                </div>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  disabled={busy}
                  rows={5}
                  placeholder="Write your Instagram caption…"
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-y"
                />
              </div>

              <div className="text-xs text-slate-500 border-t border-slate-200 dark:border-slate-800 pt-3 space-y-1">
                <p><span className="text-slate-500 dark:text-slate-400">Video:</span> {composition.width}×{composition.height} · {composition.duration}s · {composition.fps}fps</p>
                {!durationOk && (
                  <p className="flex items-start gap-1.5 text-amber-500">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    Instagram Reels must be at least 3 seconds — this composition is {composition.duration}s.
                  </p>
                )}
                {aspectHint && (
                  <p className="flex items-start gap-1.5 text-amber-500">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    {aspectHint}
                  </p>
                )}
                <p className="flex items-start gap-1.5 text-amber-500">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  Publishing is immediate and public. The MP4 renders in your browser (can take a minute), uploads, then posts as a Reel.
                </p>
              </div>

              {error && <p className="text-xs text-red-400 break-words">{error}</p>}
              {busy && (
                <p className="flex items-center gap-2 text-xs text-sky-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {progress}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition disabled:opacity-40"
          >
            {posted ? 'Close' : 'Cancel'}
          </button>
          {!posted && (
            <button
              onClick={handlePublish}
              disabled={busy || !accountId || caption.length > IG_CAPTION_MAX}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition bg-gradient-to-r from-fuchsia-600 to-orange-500 hover:from-fuchsia-500 hover:to-orange-400 disabled:from-slate-200 disabled:to-slate-200 dark:disabled:from-slate-700 dark:disabled:to-slate-700 disabled:text-slate-500 text-white flex items-center gap-1.5"
              title="Render the MP4, upload it, and publish it as an Instagram Reel now"
            >
              {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Publishing…</> : <><Instagram className="w-3.5 h-3.5" /> Publish Reel</>}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
