/**
 * Video file upload.
 *
 * Uploads to the dedicated `vemotion-video` R2 bucket via the vemotion-worker
 * (`POST /vemotion/video/upload`, authed with the user's X-API-Token). The
 * returned URL points back at the worker's public, Range-capable serving
 * endpoint (`GET /vemotion/video?key=…`), so a <video> element can stream and
 * seek it. This is video-specific storage — NOT the audio/transcription R2.
 */

import { readStoredUser } from './auth';

const VEMOTION_API = 'https://api.vegvisr.org/vemotion';

export interface VideoUploadResult {
  /** Public, Range-capable URL — assign straight to a video layer's properties.src. */
  url: string;
  key: string;
}

/**
 * Cloudflare rejects any Worker request body over ~100 MB AT THE EDGE, before
 * the worker runs — so the rejection (HTTP 413) carries no CORS header and the
 * browser can only report it as an opaque CORS / "Failed to fetch" error. Guard
 * client-side so an oversized file gives a clear message instead of that crash.
 */
export const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(0);

export async function uploadVideoFile(file: File): Promise<VideoUploadResult> {
  const token = readStoredUser()?.emailVerificationToken;
  if (!token) throw new Error('Not authenticated');

  if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
    throw new Error(
      `Video is ${mb(file.size)} MB — the uploader supports up to ${mb(MAX_VIDEO_UPLOAD_BYTES)} MB ` +
      `(Cloudflare request limit). Trim or compress the clip, or link it by URL instead.`
    );
  }

  let res: Response;
  try {
    res = await fetch(`${VEMOTION_API}/video/upload`, {
      method: 'POST',
      headers: {
        'X-API-Token': token,
        'X-File-Name': encodeURIComponent(file.name),
        'Content-Type': file.type || 'video/mp4',
      },
      body: file,
    });
  } catch {
    // A too-large body is rejected at the edge with no CORS header, so fetch
    // rejects here rather than resolving with a status. Give a size-aware hint.
    throw new Error(
      `Could not reach the upload server. If the file is large (near ${mb(MAX_VIDEO_UPLOAD_BYTES)} MB) it may exceed the limit — trim or compress it.`
    );
  }
  if (!res.ok) {
    if (res.status === 413) throw new Error(`Video is too large (over ${mb(MAX_VIDEO_UPLOAD_BYTES)} MB). Trim or compress the clip.`);
    throw new Error(`Video upload failed: HTTP ${res.status}`);
  }
  const data = await res.json() as { url?: string; key?: string };
  if (!data.url) throw new Error('Video upload returned no URL');
  return { url: data.url, key: data.key ?? '' };
}
