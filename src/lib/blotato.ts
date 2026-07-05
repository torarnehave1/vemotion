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
 * Render each carousel slide to a PNG and upload it to the VEmotion album,
 * returning the public image URLs in slide order (the order Instagram shows
 * them in the carousel). Sequential so `onProgress` reads sensibly and the
 * photos worker isn't hammered.
 *
 * `slideTimes` are capture times in seconds (see `carouselSlideTimes`).
 */
export async function uploadSlidesForCarousel(
  composition: CompositionData,
  slideTimes: number[],
  fileBase = 'slide',
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  if (slideTimes.length === 0) throw new Error('No slides to post');
  const urls: string[] = [];
  for (let i = 0; i < slideTimes.length; i++) {
    const frame = Math.max(0, Math.round(slideTimes[i] * composition.fps));
    const blob = await captureFramePngBlob(composition, frame);
    const file = new File([blob], `${fileBase}-${String(i + 1).padStart(2, '0')}.png`, { type: 'image/png' });
    urls.push(await uploadImageToAlbum(file));
    onProgress?.(i + 1, slideTimes.length);
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
 * Publish a set of image URLs as one Instagram carousel post via the
 * blotato-worker. Two or more `mediaUrls` = a carousel; one = a single image.
 *
 * NOTE: this publishes immediately and publicly to the chosen account. The
 * caller is responsible for confirming intent before invoking it.
 */
export async function postInstagramCarousel(
  accountId: string,
  mediaUrls: string[],
  caption: string,
): Promise<CarouselPostResult> {
  if (!accountId) throw new Error('No Instagram account selected');
  if (mediaUrls.length === 0) throw new Error('No images to post');
  const payload = {
    post: {
      accountId,
      content: {
        text: caption,
        mediaUrls,
        platform: 'instagram',
      },
      target: { targetType: 'instagram' },
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
