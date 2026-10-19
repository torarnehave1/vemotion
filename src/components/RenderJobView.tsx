import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertTriangle, CheckCircle2, Video } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import { readStoredUser } from '../lib/auth';
import { renderSlideBlobs, renderVideoBlob } from '../lib/blotato';
import { uploadImageToAlbum } from '../lib/photoAlbum';
import { analyseAudioFromUrl, missingAudioTrackSource } from '../lib/audioAnalysis';
import { buildKnittingChart } from '../lib/knitting';

const VEMOTION_API = 'https://api.vegvisr.org/vemotion';

/**
 * `?renderJob=<jobId>` — render a job queued from the MCP server (render_vemotion_for_instagram).
 *
 * The composition is only ever turned into an MP4 here, in the browser (canvas + ffmpeg.wasm), so
 * the MCP server queues a job on vemotion-worker and hands the user this URL. This page loads the
 * job (owner only), renders the composition snapshot it carries, uploads the MP4 to the job's
 * target album (`ig-reels-<username>`, the same album create_media_upload uses) and marks the job
 * done with the public URL — which get_vemotion_render then hands back to the MCP client.
 * Progress is reported to the job as it goes, so the client sees rendering / uploading too.
 *
 * A job of kind "frames" (preview_vemotion_frames, 2026-10-19) renders still PNGs at the job's
 * `times` instead — scaled so the long side is at most 960 px, enough to judge a design and small
 * enough for the MCP server to hand the images straight to Claude — uploads them to the job's album
 * (vemotion-previews) and marks the job done with one URL per time.
 *
 * A job of kind "pixel-grid" (pixelate_image_for_vemotion) carries no composition: it turns one
 * image into a knitting-chart grid with the Pixel Grid tab's own code (buildKnittingChart needs a
 * canvas) and reports { cols, rows, palette, cells } as the job's result.
 *
 * Before drawing, a composition with an audio layer but no meta.audioTrack gets one (an agent cannot
 * analyse audio), so formulas reading amp draw the same here as in the editor.
 */

interface RenderJob {
  jobId: string;
  status: string;
  name?: string;
  outputUrl?: string | null;
  error?: string | null;
  target?: { platform?: string; accountId?: string; username?: string; album?: string } | null;
  composition?: CompositionData;
  progress?: number;
  kind?: 'video' | 'frames' | 'pixel-grid';
  times?: number[] | null;
  outputUrls?: string[] | null;
  pixelGrid?: { imageUrl: string; cols: number; colors: number } | null;
  result?: { cols: number; rows: number; palette: string[]; cells: string[] } | null;
  updatedAt?: string;
}

type Phase = 'loading' | 'busy' | 'rendering' | 'uploading' | 'done' | 'failed';

// A job that reported progress this recently is assumed to be rendering in another tab. Older
// than this, a 'rendering'/'uploading' job is treated as stuck (tab closed mid-render) and this
// page restarts it. Decided 2026-10-19: stuck jobs can be re-rendered; done/failed stay final.
const STALE_MS = 5 * 60 * 1000;

function token(): string {
  const t = readStoredUser()?.emailVerificationToken;
  if (!t) throw new Error('Not signed in — sign in to VEmotion and open this link again.');
  return t;
}

async function updateJob(id: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${VEMOTION_API}/render/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': token() },
    body: JSON.stringify({ id, ...body }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Could not update the render job (HTTP ${res.status})`);
  }
}

// Preview frames: long side at most this many pixels.
const PREVIEW_MAX_SIDE = 960;

async function shrinkPng(blob: Blob, maxSide: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale >= 1) return blob;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the PNG'))), 'image/png'));
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'vemotion-reel';
}

export function RenderJobView({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<RenderJob | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('Loading the render job…');
  const [error, setError] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [frameUrls, setFrameUrls] = useState<string[]>([]);
  const [pixelResult, setPixelResult] = useState<string | null>(null);
  const started = useRef(false);
  const objectUrlRef = useRef<string | null>(null);

  const runFrames = async (data: RenderJob, composition: CompositionData, album: string) => {
    const times = data.times ?? [];
    if (times.length === 0) throw new Error('The job has no frame times.');
    setPhase('rendering');
    await updateJob(jobId, { status: 'rendering', progress: 0 });
    // The last frame of a d-second clip is at d − 1/fps; a time of exactly d would be past it.
    const lastFrame = Math.max(0, composition.duration - 1 / (composition.fps || 30));
    const blobs = await renderSlideBlobs(composition, times.map((t) => Math.min(t, lastFrame)), (done, total) => {
      setMessage(`Rendering frame ${done} of ${total}…`);
    });
    setPhase('uploading');
    await updateJob(jobId, { status: 'uploading', progress: 50 });
    const urls: string[] = [];
    for (let i = 0; i < blobs.length; i++) {
      setMessage(`Uploading frame ${i + 1} of ${blobs.length} to album ${album}…`);
      const small = await shrinkPng(blobs[i], PREVIEW_MAX_SIDE);
      const file = new File([small], `${slugify(data.name || 'vemotion')}-t${String(times[i]).replace('.', '_')}s.png`, { type: 'image/png' });
      urls.push(await uploadImageToAlbum(file, album));
      setFrameUrls([...urls]);
    }
    await updateJob(jobId, { status: 'done', outputUrls: urls });
    setOutputUrl(urls[0]);
    setPhase('done');
    setMessage(`${urls.length} frame(s) rendered and uploaded.`);
  };

  const runPixelGrid = async (spec: NonNullable<RenderJob['pixelGrid']>) => {
    setPhase('rendering');
    setMessage('Loading the image…');
    await updateJob(jobId, { status: 'rendering', progress: 0 });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not load the image (it must be a public image that allows cross-origin use).'));
      el.src = spec.imageUrl;
    });
    setMessage(`Pixelating into ${spec.cols} columns, ${spec.colors} colours…`);
    const chart = buildKnittingChart(img, spec.cols, spec.colors);
    await updateJob(jobId, { status: 'done', result: { cols: chart.cols, rows: chart.rows, palette: chart.palette, cells: chart.cells } });
    setPixelResult(`${chart.cols} × ${chart.rows} stitches, ${chart.palette.length} colours`);
    setPhase('done');
    setMessage('Grid made.');
  };

  // An agent-built composition has no loudness track for its audio layer; make it here so the
  // render draws amp-driven formulas the way the editor does. The job's snapshot is not changed.
  const withAudioTrack = async (composition: CompositionData): Promise<CompositionData> => {
    const url = missingAudioTrackSource(composition);
    if (!url) return composition;
    try {
      setMessage('Analysing the audio…');
      const track = await analyseAudioFromUrl(url, 30);
      return { ...composition, meta: { ...composition.meta, audioTrack: track } };
    } catch {
      return composition;
    }
  };

  const run = async (data: RenderJob) => {
      try {
        if (data.kind === 'pixel-grid') {
          if (!data.pixelGrid) throw new Error('The job has no image to pixelate.');
          await runPixelGrid(data.pixelGrid);
          return;
        }
        if (!data.composition) throw new Error('The job carries no composition.');
        const composition = await withAudioTrack(data.composition);
        const album = data.target?.album;
        if (!album) throw new Error('The job has no target album.');
        if (data.kind === 'frames') {
          await runFrames(data, composition, album);
          return;
        }

        setPhase('rendering');
        await updateJob(jobId, { status: 'rendering', progress: 0 });
        let lastReported = 0;
        const blob = await renderVideoBlob(composition, (p) => {
          setMessage(p.message || `Rendering… ${Math.round(p.percent)}%`);
          const pct = Math.round(p.percent);
          // Report every 10% so the MCP client can see it move, without a request per frame.
          if (pct >= lastReported + 10) {
            lastReported = pct;
            updateJob(jobId, { status: 'rendering', progress: pct }).catch(() => { /* progress is best-effort */ });
          }
        });
        objectUrlRef.current = URL.createObjectURL(blob);
        setVideoSrc(objectUrlRef.current);

        setPhase('uploading');
        setMessage(`Uploading to album ${album}…`);
        await updateJob(jobId, { status: 'uploading', progress: 95 });
        const file = new File([blob], `${slugify(data.name || 'vemotion-reel')}.mp4`, { type: 'video/mp4' });
        const url = await uploadImageToAlbum(file, album);

        await updateJob(jobId, { status: 'done', outputUrl: url });
        setOutputUrl(url);
        setPhase('done');
        setMessage('Rendered and uploaded.');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setPhase('failed');
        updateJob(jobId, { status: 'failed', error: msg }).catch(() => { /* already finished or not ours */ });
      }
  };

  useEffect(() => {
    if (started.current) return; // StrictMode mounts twice; render once.
    started.current = true;

    (async () => {
      try {
        const res = await fetch(`${VEMOTION_API}/render?id=${encodeURIComponent(jobId)}`, {
          headers: { 'X-API-Token': token() },
        });
        const data = (await res.json().catch(() => ({}))) as RenderJob & { error?: string };
        if (!res.ok) throw new Error(data.error || `Could not load render job (HTTP ${res.status})`);
        setJob(data);

        if (data.status === 'done' && data.kind === 'pixel-grid' && data.result) {
          setPixelResult(`${data.result.cols} × ${data.result.rows} stitches, ${data.result.palette.length} colours`);
          setPhase('done');
          setMessage('This grid is already made.');
          return;
        }
        if (data.status === 'done' && data.outputUrl) {
          setOutputUrl(data.outputUrl);
          setFrameUrls(data.outputUrls ?? []);
          setPhase('done');
          setMessage('This job is already rendered.');
          return;
        }
        if (data.status === 'failed') throw new Error(data.error || 'This job has already failed. Queue a new one.');
        const lastSeen = data.updatedAt ? Date.parse(data.updatedAt) : 0;
        if ((data.status === 'rendering' || data.status === 'uploading') && Date.now() - lastSeen < STALE_MS) {
          const mins = Math.max(1, Math.round((Date.now() - lastSeen) / 60000));
          setPhase('busy');
          setMessage(`This job is ${data.status} in another tab (${data.progress ?? 0}%, last progress ${mins} min ago).`);
          return;
        }
        await run(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase('failed');
      }
    })();

    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const target = job?.target;
  const isFrames = job?.kind === 'frames';
  const isPixel = job?.kind === 'pixel-grid';
  return (
    <div className="flex-1 flex items-start justify-center p-4 sm:p-8">
      <div className="w-full max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
          <Video className="w-5 h-5" />
          <h1 className="text-lg font-semibold">{isPixel ? 'Make a pixel grid' : isFrames ? 'Render preview frames' : 'Render for Instagram'}</h1>
        </div>
        <dl className="text-sm text-slate-600 dark:text-slate-300 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
          <dt className="font-medium">Composition</dt>
          <dd>{job?.name || '…'}</dd>
          {isPixel ? (
            <>
              <dt className="font-medium">Image</dt>
              <dd className="break-all">{job?.pixelGrid?.imageUrl}</dd>
              <dt className="font-medium">Grid</dt>
              <dd>{job?.pixelGrid ? `${job.pixelGrid.cols} columns, ${job.pixelGrid.colors} colours` : '…'}</dd>
            </>
          ) : isFrames ? (
            <>
              <dt className="font-medium">Frames at</dt>
              <dd>{(job?.times ?? []).map((t) => `${t}s`).join(', ')}</dd>
            </>
          ) : (
            <>
              <dt className="font-medium">Account</dt>
              <dd>{target?.username ? `@${target.username}` : '…'}</dd>
            </>
          )}
          {!isPixel && (
            <>
              <dt className="font-medium">Album</dt>
              <dd>{target?.album || '…'}</dd>
            </>
          )}
          <dt className="font-medium">Job</dt>
          <dd className="font-mono text-xs break-all">{jobId}</dd>
        </dl>

        {(phase === 'loading' || phase === 'rendering' || phase === 'uploading') && (
          <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{message}</span>
          </div>
        )}
        {phase === 'busy' && job && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-900 dark:text-amber-200 space-y-2">
            <p>{message} If that tab was closed, render it here instead.</p>
            <button
              type="button"
              onClick={() => run(job)}
              className="rounded-md bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 text-sm font-medium"
            >
              Render here anyway
            </button>
          </div>
        )}

        {phase === 'rendering' && (
          <p className="text-xs text-slate-500 dark:text-slate-400">Keep this tab open until the upload is done.</p>
        )}

        {frameUrls.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {frameUrls.map((u, i) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" className="block">
                <img src={u} alt={`Frame at ${job?.times?.[i]}s`} className="w-full rounded-md bg-black" />
                <span className="text-xs text-slate-500">{job?.times?.[i]}s</span>
              </a>
            ))}
          </div>
        )}

        {videoSrc && <video src={videoSrc} controls className="w-full max-h-[60vh] rounded-lg bg-black" />}

        {phase === 'done' && isPixel && pixelResult && (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm text-emerald-800 dark:text-emerald-200 space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4" /> {message} {pixelResult}.
            </div>
            <p>Go back to Claude: it can now put this grid in a composition.</p>
          </div>
        )}

        {phase === 'done' && !isPixel && outputUrl && (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm text-emerald-800 dark:text-emerald-200 space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4" /> {message}
            </div>
            {!isFrames && <a href={outputUrl} target="_blank" rel="noreferrer" className="underline break-all">{outputUrl}</a>}
            <p>{isFrames ? 'Go back to Claude: it can now look at these frames.' : 'Go back to Claude: it can now preview and post this reel.'}</p>
          </div>
        )}

        {phase === 'failed' && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-800 dark:text-red-200 flex gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
