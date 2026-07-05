import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Instagram, ExternalLink, AlertTriangle, ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import { carouselSlideTimes } from '../lib/screenshot';
import {
  listInstagramAccounts,
  renderSlideBlobs,
  uploadCarouselBlobs,
  postInstagramCarousel,
  type BlotatoAccount,
} from '../lib/blotato';

interface PostCarouselModalProps {
  composition: CompositionData;
  onClose: () => void;
}

const IG_CAPTION_MAX = 2200;

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

/**
 * "Post as Instagram carousel" — a two-step flow mirroring Instagram's own
 * composer: STEP 1 review every slide (swipe through the real rendered PNGs),
 * STEP 2 write the caption + pick the account, then Share. Slides are rendered
 * once on open (for the review), and those same blobs are uploaded at publish
 * time — no re-render.
 *
 * Publishing is immediate and public; Share on step 2 is the only trigger.
 */
export const PostCarouselModal: React.FC<PostCarouselModalProps> = ({ composition, onClose }) => {
  const slideTimes = useMemo(() => carouselSlideTimes(composition), [composition]);
  const fileBase = composition.meta?.carousel?.fileBase ?? 'slide';

  const [step, setStep] = useState<1 | 2>(1);
  const [blobs, setBlobs] = useState<Blob[] | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [renderProgress, setRenderProgress] = useState(`0/${slideTimes.length}`);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  const [accounts, setAccounts] = useState<BlotatoAccount[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string>('');
  const [caption, setCaption] = useState<string>(composition.meta?.description ?? '');

  const [phase, setPhase] = useState<'idle' | 'uploading' | 'posting'>('idle');
  const [publishProgress, setPublishProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  const urlsRef = useRef<string[]>([]);
  // True only when a mouse press STARTED on the backdrop itself — so a
  // textarea-resize drag that happens to release over the backdrop doesn't
  // close the modal (the click target is the backdrop, but the press wasn't).
  const backdropPressRef = useRef(false);

  // Render every slide to a PNG on open — this is the review material AND the
  // exact bytes that get uploaded at publish. Object URLs revoked on unmount.
  useEffect(() => {
    let cancelled = false;
    renderSlideBlobs(composition, slideTimes, (done, total) => {
      if (!cancelled) setRenderProgress(`${done}/${total}`);
    })
      .then((bs) => {
        if (cancelled) return;
        const urls = bs.map((b) => URL.createObjectURL(b));
        urlsRef.current = urls;
        setBlobs(bs);
        setPreviewUrls(urls);
      })
      .catch((e) => { if (!cancelled) setRenderError(e instanceof Error ? e.message : String(e)); });
    return () => {
      cancelled = true;
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [composition, slideTimes]);

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

  const busy = phase !== 'idle';
  const rendering = blobs === null && !renderError;

  const go = (d: number) => setIndex((i) => (i + d + slideTimes.length) % slideTimes.length);

  const handlePublish = async () => {
    if (busy || posted || !blobs) return;
    setError(null);
    try {
      setPhase('uploading');
      setPublishProgress(`Uploading slide 0/${blobs.length}`);
      const urls = await uploadCarouselBlobs(blobs, fileBase, (done, total) => setPublishProgress(`Uploading slide ${done}/${total}`));
      setPhase('posting');
      setPublishProgress('Publishing carousel to Instagram…');
      const result = await postInstagramCarousel(accountId, urls, caption);
      setResultUrl(extractPostUrl(result.data));
      setPosted(true);
      setPhase('idle');
      setPublishProgress('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
      setPublishProgress('');
    }
  };

  const selectedAccount = accounts?.find((a) => a.id === accountId);
  const title = posted ? 'Shared' : step === 1 ? 'Review your slides' : 'Caption and share';

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
        {/* Header — back arrow (step 2) · title · close */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          {step === 2 && !posted ? (
            <button onClick={() => setStep(1)} disabled={busy} className="p-1 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 disabled:opacity-40" title="Back to slides">
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <span className="w-6 flex items-center"><Instagram className="w-4 h-4 text-slate-500" /></span>
          )}
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-200">{title}</h2>
          <button onClick={onClose} disabled={busy} className="p-1 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 disabled:opacity-40" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {posted ? (
            <div className="space-y-3">
              <p className="text-sm text-emerald-500 font-medium">
                Carousel published to {selectedAccount ? `@${selectedAccount.username}` : 'Instagram'}.
              </p>
              {resultUrl ? (
                <a href={resultUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-sky-500 hover:text-sky-400 underline">
                  View on Instagram <ExternalLink className="w-3.5 h-3.5" />
                </a>
              ) : (
                <p className="text-xs text-slate-500">Blotato accepted the post. It may take a moment to appear on your profile.</p>
              )}
            </div>
          ) : step === 1 ? (
            <>
              {/* Slide carousel — the real rendered slides */}
              <div className="relative bg-slate-950 rounded-lg overflow-hidden" style={{ aspectRatio: `${composition.width} / ${composition.height}` }}>
                {rendering ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-xs">Rendering slides… {renderProgress}</span>
                  </div>
                ) : renderError ? (
                  <div className="absolute inset-0 flex items-center justify-center p-4 text-xs text-red-400 text-center">{renderError}</div>
                ) : (
                  <>
                    <img src={previewUrls[index]} alt={`Slide ${index + 1}`} className="w-full h-full object-contain" />
                    {slideTimes.length > 1 && (
                      <>
                        <button onClick={() => go(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/45 flex items-center justify-center text-white" title="Previous slide"><ChevronLeft className="w-4 h-4" /></button>
                        <button onClick={() => go(1)} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/45 flex items-center justify-center text-white" title="Next slide"><ChevronRight className="w-4 h-4" /></button>
                      </>
                    )}
                    <div className="absolute top-2 right-2 bg-black/55 text-white text-[11px] px-2 py-0.5 rounded-full">{index + 1}/{slideTimes.length}</div>
                  </>
                )}
              </div>
              {/* Dots */}
              {!rendering && !renderError && slideTimes.length > 1 && (
                <div className="flex justify-center gap-1.5">
                  {slideTimes.map((_, k) => (
                    <button key={k} onClick={() => setIndex(k)} className={`w-1.5 h-1.5 rounded-full ${k === index ? 'bg-sky-500' : 'bg-slate-500/50'}`} aria-label={`Go to slide ${k + 1}`} />
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-500 text-center">
                {slideTimes.length} slides · {composition.width}×{composition.height} {composition.width === 1080 && composition.height === 1350 ? '(4:5)' : '(non-4:5 — Instagram may crop)'}
              </p>
            </>
          ) : (
            <>
              {/* Caption step — small preview + account + caption */}
              <div className="flex gap-3 items-start">
                <div className="w-16 rounded-md overflow-hidden bg-slate-950 flex-shrink-0" style={{ aspectRatio: `${composition.width} / ${composition.height}` }}>
                  {previewUrls[0] && <img src={previewUrls[0]} alt="First slide" className="w-full h-full object-contain" />}
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

              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Instagram account</label>
                {accountsError ? (
                  <p className="text-xs text-red-400">{accountsError}</p>
                ) : accounts === null ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading accounts…</div>
                ) : accounts.length === 0 ? (
                  <p className="text-xs text-amber-500">No Instagram account is connected in Blotato.</p>
                ) : (
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={busy} className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                    {accounts.map((a) => <option key={a.id} value={a.id}>@{a.username}{a.fullname ? ` — ${a.fullname}` : ''}</option>)}
                  </select>
                )}
              </div>

              <p className="flex items-start gap-1.5 text-[11px] text-amber-500">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                Publishing is immediate and public. Slides upload to your VEmotion album, then post as one carousel.
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
                  disabled={busy || !accountId || !blobs || caption.length > IG_CAPTION_MAX}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-fuchsia-600 to-orange-500 hover:from-fuchsia-500 hover:to-orange-400 disabled:from-slate-200 disabled:to-slate-200 dark:disabled:from-slate-700 dark:disabled:to-slate-700 disabled:text-slate-500 text-white flex items-center gap-1.5"
                >
                  {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Publishing…</> : <><Instagram className="w-3.5 h-3.5" /> Share carousel</>}
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
