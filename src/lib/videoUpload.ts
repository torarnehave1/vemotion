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

export async function uploadVideoFile(file: File): Promise<VideoUploadResult> {
  const token = readStoredUser()?.emailVerificationToken;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`${VEMOTION_API}/video/upload`, {
    method: 'POST',
    headers: {
      'X-API-Token': token,
      'X-File-Name': encodeURIComponent(file.name),
      'Content-Type': file.type || 'video/mp4',
    },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Video upload failed: HTTP ${res.status}`);
  }
  const data = await res.json() as { url?: string; key?: string };
  if (!data.url) throw new Error('Video upload returned no URL');
  return { url: data.url, key: data.key ?? '' };
}
