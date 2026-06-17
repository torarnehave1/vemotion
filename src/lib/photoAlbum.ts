/**
 * Photo-album upload — reuses the existing Vegvisr photos worker (Lesson 22),
 * the same `/upload` endpoint the Images tab uses. Used to persist a pixel
 * grid's SOURCE image into the VEmotion album so the layer can be
 * re-pixelated later (different stitch count / colour count) without the
 * original file — the chart cells alone can't be re-derived at higher detail.
 *
 * The worker returns `{ urls: [imgix-url], keys, album }`; we return the URL.
 */
import { readStoredUser } from './auth';

const PHOTOS_API = 'https://photos-api.vegvisr.org';
const ALBUMS_API = 'https://albums.vegvisr.org';
export const VEMOTION_ALBUM = 'VEmotion';

/** One image in a photo album, as returned by `list-r2-images`. */
export interface AlbumImage {
  key: string;
  url: string;
  name?: string;
  displayName?: string;
  tags?: string[];
}

/**
 * List the names of the user's photo albums. Mirrors the Images-tab fetch in
 * AddLayerModal so the Pixel Grid tab can offer the same album picker.
 * Returns [] when unauthenticated or on error (caller keeps a default album).
 */
export async function listAlbums(): Promise<string[]> {
  const token = readStoredUser()?.emailVerificationToken;
  if (!token) return [];
  const res = await fetch(`${ALBUMS_API}/photo-albums`, { headers: { 'X-API-Token': token } });
  if (!res.ok) return [];
  const data = await res.json() as { albums?: unknown[] };
  if (!Array.isArray(data?.albums)) return [];
  // Schema items can be `string` or `{ name }`; we only need names.
  return data.albums
    .map((a) => (typeof a === 'string' ? a : (a as { name?: string })?.name))
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
}

/** List the images in one album. Throws on auth failure / network error. */
export async function listAlbumImages(album: string = VEMOTION_ALBUM): Promise<AlbumImage[]> {
  const token = readStoredUser()?.emailVerificationToken;
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${PHOTOS_API}/list-r2-images?album=${encodeURIComponent(album)}`, {
    headers: { 'X-API-Token': token },
  });
  if (!res.ok) throw new Error(`Failed to load album: HTTP ${res.status}`);
  const data = await res.json() as { images?: AlbumImage[] };
  return data.images ?? [];
}

// ── Stock image search (Unsplash + Pexels) ──────────────────────────────────
// Reuses the exact endpoints the production ImageSelector.vue calls, so the
// Pixel Grid tab can pull a stock photo as a pixelation source.

const API_BASE = 'https://api.vegvisr.org';

export type StockProvider = 'unsplash' | 'pexels';

/** One stock-search result. `download_location` (Unsplash only) is needed for
 *  download-tracking compliance when the image is actually used. */
export interface StockImage {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
  photographer?: string;
  download_location?: string;
}

/**
 * Search Unsplash or Pexels. Mirrors ImageSelector.vue: POST { query, count }
 * to /unsplash-search or /pexels-search (no auth), response `{ images: [...] }`.
 */
export async function searchStockImages(
  provider: StockProvider,
  query: string,
  count = 20,
): Promise<StockImage[]> {
  const endpoint = provider === 'unsplash' ? `${API_BASE}/unsplash-search` : `${API_BASE}/pexels-search`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: query.trim(), count }),
  });
  if (!res.ok) throw new Error(`Image search failed: HTTP ${res.status}`);
  const data = await res.json() as { images?: StockImage[] };
  return data.images ?? [];
}

/**
 * Unsplash download-tracking (compliance) — best-effort, fire-and-forget.
 * Matches ImageSelector.vue / GNewViewer.vue: POST { download_location }.
 */
export async function trackUnsplashDownload(downloadLocation?: string): Promise<void> {
  if (!downloadLocation) return;
  try {
    await fetch(`${API_BASE}/unsplash-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ download_location: downloadLocation }),
    });
  } catch { /* tracking is best-effort; ignore failures */ }
}

/**
 * Copy an external image URL (stock photo, AI-generated image) into the
 * VEmotion album and return the album (imgix) URL. This sidesteps cross-origin
 * canvas tainting at pixelation time and makes the source re-pixelatable from
 * the edit form — same contract as an uploaded source image.
 */
export async function importImageUrlToAlbum(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch image: HTTP ${res.status}`);
  const blob = await res.blob();
  return uploadImageToAlbum(blob);
}

const OPENAI_API = 'https://openai.vegvisr.org';

const base64ToBlob = (b64: string, type = 'image/png'): Blob => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

/**
 * Generate an image with OpenAI (via the openai-worker) and store it in the
 * VEmotion album, returning the album (imgix) URL. Default model gpt-image-2
 * (the current OpenAI image model — verified against the live docs 2026-06).
 * gpt-image-* returns base64 (b64_json); dall-e returns a url — both handled.
 */
export async function generateAiImageToAlbum(
  prompt: string,
  opts: { model?: string; size?: string } = {},
): Promise<string> {
  const { model = 'gpt-image-2', size = '1024x1024' } = opts;
  const res = await fetch(`${OPENAI_API}/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: prompt.trim(), model, size }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Image generation failed: HTTP ${res.status} ${err.slice(0, 200)}`);
  }
  const data = await res.json() as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = data.data?.[0];
  if (item?.b64_json) return uploadImageToAlbum(base64ToBlob(item.b64_json));
  if (item?.url) return importImageUrlToAlbum(item.url);
  throw new Error('Image generation returned no image');
}

export async function uploadImageToAlbum(file: File | Blob, album: string = VEMOTION_ALBUM): Promise<string> {
  const user = readStoredUser();
  const token = user?.emailVerificationToken;
  const email = user?.email;
  if (!token || !email) throw new Error('Not authenticated');

  const fd = new FormData();
  // The worker keeps only entries that are `instanceof File`; appending a raw
  // Blob with a filename makes FormData wrap it as a File so it isn't dropped.
  const filename = file instanceof File ? file.name : 'screenshot.png';
  fd.append('file', file, filename);
  fd.append('album', album);
  fd.append('userEmail', email);

  const res = await fetch(`${PHOTOS_API}/upload`, {
    method: 'POST',
    headers: { 'X-API-Token': token },
    body: fd,
  });
  if (!res.ok) throw new Error(`Image upload failed: HTTP ${res.status}`);
  const data = await res.json() as { urls?: string[] };
  const url = data.urls?.[0];
  if (!url) throw new Error('Image upload returned no URL');
  return url;
}
