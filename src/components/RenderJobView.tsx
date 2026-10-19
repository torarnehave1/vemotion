import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertTriangle, CheckCircle2, Video } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import { readStoredUser } from '../lib/auth';
import { renderVideoBlob } from '../lib/blotato';
import { uploadImageToAlbum } from '../lib/photoAlbum';

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
 */

interface RenderJob {
  jobId: string;
  status: string;
  name?: string;
  outputUrl?: string | null;
  error?: string | null;
  target?: { platform?: string; accountId?: string; username?: string; album?: string } | null;
  composition?: CompositionData;
}

type Phase = 'loading' | 'rendering' | 'uploading' | 'done' | 'failed';

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
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode mounts twice; render once.
    started.current = true;
    let objectUrl: string | null = null;

    (async () => {
      try {
        const res = await fetch(`${VEMOTION_API}/render?id=${encodeURIComponent(jobId)}`, {
          headers: { 'X-API-Token': token() },
        });
        const data = (await res.json().catch(() => ({}))) as RenderJob & { error?: string };
        if (!res.ok) throw new Error(data.error || `Could not load render job (HTTP ${res.status})`);
        setJob(data);

        if (data.status === 'done' && data.outputUrl) {
          setOutputUrl(data.outputUrl);
          setPhase('done');
          setMessage('This job is already rendered.');
          return;
        }
        if (data.status === 'failed') throw new Error(data.error || 'This job has already failed. Queue a new one.');
        if (!data.composition) throw new Error('The job carries no composition.');
        const album = data.target?.album;
        if (!album) throw new Error('The job has no target album.');

        setPhase('rendering');
        await updateJob(jobId, { status: 'rendering', progress: 0 });
        let lastReported = 0;
        const blob = await renderVideoBlob(data.composition, (p) => {
          setMessage(p.message || `Rendering… ${Math.round(p.percent)}%`);
          const pct = Math.round(p.percent);
          // Report every 10% so the MCP client can see it move, without a request per frame.
          if (pct >= lastReported + 10) {
            lastReported = pct;
            updateJob(jobId, { status: 'rendering', progress: pct }).catch(() => { /* progress is best-effort */ });
          }
        });
        objectUrl = URL.createObjectURL(blob);
        setVideoSrc(objectUrl);

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
    })();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [jobId]);

  const target = job?.target;
  return (
    <div className="flex-1 flex items-start justify-center p-4 sm:p-8">
      <div className="w-full max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
          <Video className="w-5 h-5" />
          <h1 className="text-lg font-semibold">Render for Instagram</h1>
        </div>
        <dl className="text-sm text-slate-600 dark:text-slate-300 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
          <dt className="font-medium">Composition</dt>
          <dd>{job?.name || '…'}</dd>
          <dt className="font-medium">Account</dt>
          <dd>{target?.username ? `@${target.username}` : '…'}</dd>
          <dt className="font-medium">Album</dt>
          <dd>{target?.album || '…'}</dd>
          <dt className="font-medium">Job</dt>
          <dd className="font-mono text-xs break-all">{jobId}</dd>
        </dl>

        {(phase === 'loading' || phase === 'rendering' || phase === 'uploading') && (
          <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{message}</span>
          </div>
        )}
        {phase === 'rendering' && (
          <p className="text-xs text-slate-500 dark:text-slate-400">Keep this tab open until the upload is done.</p>
        )}

        {videoSrc && <video src={videoSrc} controls className="w-full max-h-[60vh] rounded-lg bg-black" />}

        {phase === 'done' && outputUrl && (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm text-emerald-800 dark:text-emerald-200 space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4" /> {message}
            </div>
            <a href={outputUrl} target="_blank" rel="noreferrer" className="underline break-all">{outputUrl}</a>
            <p>Go back to Claude: it can now preview and post this reel.</p>
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
