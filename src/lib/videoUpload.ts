/**
 * Video file upload.
 *
 * Reuses the same binary → R2 path the audio layer uses
 * (norwegian-transcription-worker POST /upload). R2 stores the bytes
 * regardless of content type, so the audio path doubles as a generic file
 * uploader — see _project/lessons_learned.md Lesson 22 (reuse ecosystem
 * infra). The returned URL is a public R2 URL usable directly as a <video>
 * src and drawable to canvas (the element is created with
 * crossOrigin='anonymous'; the R2 host serves the same CORS the image layers
 * already rely on).
 */

const TRANSCRIPTION_WORKER = 'https://norwegian-transcription-worker.torarnehave.workers.dev';

export interface VideoUploadResult {
  /** Public R2 URL — assign straight to a video layer's properties.src. */
  url: string;
  r2Key: string;
}

export async function uploadVideoFile(file: File): Promise<VideoUploadResult> {
  const res = await fetch(`${TRANSCRIPTION_WORKER}/upload`, {
    method: 'POST',
    headers: { 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Video upload failed: HTTP ${res.status}`);
  }
  const data = await res.json() as { audioUrl?: string; url?: string; r2Key?: string };
  // The worker labels its response field `audioUrl` regardless of payload
  // type; accept `url` too in case the contract is generalised later.
  const url = data.audioUrl ?? data.url;
  if (!url) throw new Error('Video upload returned no URL');
  return { url, r2Key: data.r2Key ?? '' };
}
