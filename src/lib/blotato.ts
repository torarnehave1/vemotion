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
 * which connected Instagram account to post as.
 */
import type { CompositionData } from './api';
import { captureFramePngBlob } from './screenshot';
import { uploadImageToAlbum } from './photoAlbum';
import { exportToMp4, type ExportProgress } from './exporter';
import { uploadVideoFile } from './videoUpload';

const BLOTATO_API = 'https://api.vegvisr.org/blotato';

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
  const res = await fetch(`${BLOTATO_API}/accounts`);
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
    headers: { 'Content-Type': 'application/json' },
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
 * Publish a set of image URLs as one Instagram carousel post. Two or more
 * `mediaUrls` = a carousel; one = a single image.
 */
export function postInstagramCarousel(
  accountId: string,
  mediaUrls: string[],
  caption: string,
): Promise<CarouselPostResult> {
  return postToInstagram(accountId, mediaUrls, caption);
}

/**
 * Publish a single video URL as an Instagram Reel. `target.mediaType: 'reel'`
 * is required by Blotato for Instagram video.
 */
export function postInstagramVideo(
  accountId: string,
  videoUrl: string,
  caption: string,
): Promise<CarouselPostResult> {
  return postToInstagram(accountId, [videoUrl], caption, { mediaType: 'reel' });
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
