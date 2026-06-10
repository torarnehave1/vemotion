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
export const VEMOTION_ALBUM = 'VEmotion';

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
