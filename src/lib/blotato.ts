/**
 * Blotato posting client — publishes a Vemotion carousel straight to Instagram
 * (and other Blotato-connected accounts) via the existing `blotato-worker`
 * proxy at `api.vegvisr.org/blotato/*` (Lesson 22: reuse the ecosystem worker,
 * don't build new infra).
 *
 * The worker forwards the body unchanged to Blotato's `POST /v2/posts`. A
 * carousel is simply MORE THAN ONE image in `content.mediaUrls` — verified
 * against Blotato's docs ("Posting multiple images to Instagram creates a
 * carousel"). `mediaUrls` accepts any publicly reachable image URL, so we
 * upload each rendered slide to the VEmotion photo album (public imgix URL)
 * and hand Blotato those URLs.
 *
 * The account id is resolved LIVE from `/blotato/accounts` (Lesson 42:
 * authoritative registry over a hard-coded/guessed id) — the caller picks
 * which connected Instagram accounts to post as. MORE THAN ONE may be picked:
 * Blotato's `/v2/posts` takes a single `accountId`, so a multi-account publish
 * is N sequential posts of the SAME media, reported per account.
 *
 * Both worker endpoints require the user's `X-API-Token`
 * (`emailVerificationToken`) — the worker resolves the caller against the D1
 * `config` table and uses that row's `blotato_api_key`. Sending no token is a
 * 401, so every call here must carry it (Lesson 36: match the auth the target
 * service actually validates).
 */
import type { CompositionData } from './api';
import { readStoredUser } from './auth';
import { captureFramePngBlob } from './screenshot';
import { uploadImageToAlbum } from './photoAlbum';
import { exportToMp4, type ExportProgress } from './exporter';
import { uploadVideoFile } from './videoUpload';

const BLOTATO_API = 'https://api.vegvisr.org/blotato';

/** The worker authenticates every non-health call against the config table. */
function authHeaders(): Record<string, string> {
  const token = readStoredUser()?.emailVerificationToken;
  if (!token) throw new Error('Not authenticated — sign in to post to Instagram');
  return { 'X-API-Token': token };
}

/** One social account connected to Blotato, as returned by `/blotato/accounts`. */
export interface BlotatoAccount {
  id: string;
  platform: string;
  username: string;
  fullname: string;
}

/**
 * List the connected Instagram accounts. The worker wraps Blotato's response as
 * `{ success, status, data: { items: [...] } }`. Returns only `platform ===
 * 'instagram'` accounts (there can be several — e.g. a personal + a brand
 * handle), so the caller can present a picker.
 */
export async function listInstagramAccounts(): Promise<BlotatoAccount[]> {
  const res = await fetch(`${BLOTATO_API}/accounts`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Could not load accounts: HTTP ${res.status}`);
  const body = await res.json() as { success?: boolean; error?: string; data?: { items?: BlotatoAccount[] } };
  if (!body.success) throw new Error(body.error || 'Blotato accounts request failed');
  const items = body.data?.items ?? [];
  return items.filter((a) => a.platform === 'instagram');
}

/**
 * Render each carousel slide to a PNG Blob in slide order — used by the
 * review step so the user sees the actual slides before anything is uploaded
 * or posted. `slideTimes` are capture times in seconds (see
 * `carouselSlideTimes`). Sequential so `onProgress` reads sensibly.
 */
export async function renderSlideBlobs(
  composition: CompositionData,
  slideTimes: number[],
  onProgress?: (done: number, total: number) => void,
): Promise<Blob[]> {
  if (slideTimes.length === 0) throw new Error('No slides to render');
  const blobs: Blob[] = [];
  for (let i = 0; i < slideTimes.length; i++) {
    const frame = Math.max(0, Math.round(slideTimes[i] * composition.fps));
    blobs.push(await captureFramePngBlob(composition, frame));
    onProgress?.(i + 1, slideTimes.length);
  }
  return blobs;
}

/**
 * Upload already-rendered slide Blobs to the VEmotion album, returning the
 * public image URLs in order (the order Instagram shows them in the carousel).
 * Split from rendering so the publish step doesn't re-render what the review
 * step already produced.
 */
export async function uploadCarouselBlobs(
  blobs: Blob[],
  fileBase = 'slide',
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 0; i < blobs.length; i++) {
    const file = new File([blobs[i]], `${fileBase}-${String(i + 1).padStart(2, '0')}.png`, { type: 'image/png' });
    urls.push(await uploadImageToAlbum(file));
    onProgress?.(i + 1, blobs.length);
  }
  return urls;
}

export interface CarouselPostResult {
  success: boolean;
  status: number;
  /** Raw Blotato response payload (post id / url / error), surfaced for the UI. */
  data: unknown;
}

/** Outcome of ONE account in a multi-account publish. */
export interface AccountPostResult {
  accountId: string;
  /** `@username` when known — the UI reports per handle, not per id. */
  username?: string;
  ok: boolean;
  /** Permalink when Blotato returned one. */
  url: string | null;
  error?: string;
}

/**
 * Pull a permalink out of Blotato's response. Shape varies by platform, so we
 * probe the keys it is known to use. Shared by both post modals.
 */
export function extractPostUrl(data: unknown): string | null {
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
 * Publish media to Instagram via the blotato-worker. Shared by the carousel
 * (images) and video (Reel) posters — the only differences are the number of
 * `mediaUrls` and whether `target.mediaType: 'reel'` is set (Blotato requires
 * that flag for Instagram video, verified against its docs).
 *
 * NOTE: this publishes immediately and publicly to the chosen account. The
 * caller is responsible for confirming intent before invoking it.
 */
async function postToInstagram(
  accountId: string,
  mediaUrls: string[],
  caption: string,
  opts: { mediaType?: 'reel' } = {},
): Promise<CarouselPostResult> {
  if (!accountId) throw new Error('No Instagram account selected');
  if (mediaUrls.length === 0) throw new Error('No media to post');
  const payload = {
    post: {
      accountId,
      content: {
        text: caption,
        mediaUrls,
        platform: 'instagram',
      },
      target: {
        targetType: 'instagram',
        ...(opts.mediaType ? { mediaType: opts.mediaType } : {}),
      },
    },
  };
  const res = await fetch(`${BLOTATO_API}/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({})) as { success?: boolean; status?: number; data?: unknown; error?: string };
  if (!res.ok || body.success === false) {
    const detail = body.error || (typeof body.data === 'string' ? body.data : JSON.stringify(body.data ?? ''));
    throw new Error(`Blotato post failed (HTTP ${body.status ?? res.status}): ${String(detail).slice(0, 300)}`);
  }
  return { success: true, status: body.status ?? res.status, data: body.data };
}

/**
 * Post the SAME media to every selected account, sequentially. Blotato has no
 * multi-account endpoint — `post.accountId` is singular — so this is N calls.
 * One account failing does NOT abort the rest: each account gets its own
 * result row so the UI can report "2 of 3 published" honestly rather than
 * throwing away the successes.
 *
 * `onProgress` fires as each account is attempted, for the publish spinner.
 */
async function postToAccounts(
  accounts: Array<{ id: string; username?: string }>,
  mediaUrls: string[],
  caption: string,
  opts: { mediaType?: 'reel' } = {},
  onProgress?: (done: number, total: number, username?: string) => void,
): Promise<AccountPostResult[]> {
  if (accounts.length === 0) throw new Error('No Instagram account selected');
  const results: AccountPostResult[] = [];
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    onProgress?.(i, accounts.length, acc.username);
    try {
      const r = await postToInstagram(acc.id, mediaUrls, caption, opts);
      results.push({ accountId: acc.id, username: acc.username, ok: true, url: extractPostUrl(r.data) });
    } catch (e) {
      results.push({
        accountId: acc.id,
        username: acc.username,
        ok: false,
        url: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    onProgress?.(i + 1, accounts.length, acc.username);
  }
  return results;
}

/**
 * Publish a set of image URLs as one Instagram carousel post, to each selected
 * account. Two or more `mediaUrls` = a carousel; one = a single image.
 */
export function postInstagramCarousel(
  accounts: Array<{ id: string; username?: string }>,
  mediaUrls: string[],
  caption: string,
  onProgress?: (done: number, total: number, username?: string) => void,
): Promise<AccountPostResult[]> {
  return postToAccounts(accounts, mediaUrls, caption, {}, onProgress);
}

/**
 * Publish a single video URL as an Instagram Reel to each selected account.
 * `target.mediaType: 'reel'` is required by Blotato for Instagram video.
 */
export function postInstagramVideo(
  accounts: Array<{ id: string; username?: string }>,
  videoUrl: string,
  caption: string,
  onProgress?: (done: number, total: number, username?: string) => void,
): Promise<AccountPostResult[]> {
  return postToAccounts(accounts, [videoUrl], caption, { mediaType: 'reel' }, onProgress);
}

/**
 * Render the composition to an MP4 Blob (client-side, ffmpeg.wasm — no
 * download). Used by the video review step so the user can watch the exact
 * clip before it uploads or posts. `onProgress` forwards the export stages.
 */
export function renderVideoBlob(
  composition: CompositionData,
  onProgress?: (p: ExportProgress) => void,
): Promise<Blob> {
  return exportToMp4(composition, onProgress, { download: false });
}

/**
 * Upload an already-rendered MP4 Blob to the public, Range-capable
 * vemotion-video host, returning the public URL to hand Blotato.
 */
export async function uploadVideoBlob(blob: Blob, fileBase = 'vemotion'): Promise<string> {
  const file = new File([blob], `${fileBase}.mp4`, { type: 'video/mp4' });
  const { url } = await uploadVideoFile(file);
  return url;
}
