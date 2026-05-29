/**
 * Audio portfolio integration.
 *
 * Two existing vegvisr workers handle audio for Vemotion (and for Contacts,
 * Sanskrit admin, Norwegian transcription, etc.) — reusing them rather than
 * standing up Vemotion-specific infra.
 *
 *   norwegian-transcription-worker  →  POST /upload         (binary → R2)
 *   audio-portfolio-worker          →  POST /save-recording (metadata KV)
 *                                      GET  /list-recordings (per-user KV)
 *
 * Despite the names neither worker is locked to Norwegian content — the
 * Contacts app uses them for English voice notes with arbitrary tags +
 * category. Vemotion uses them the same way, tagged 'vemotion' + 'voice-over'
 * with category 'Vemotion'.
 */

const TRANSCRIPTION_WORKER = 'https://norwegian-transcription-worker.torarnehave.workers.dev';
const PORTFOLIO_WORKER = 'https://audio-portfolio-worker.torarnehave.workers.dev';

export const VEMOTION_AUDIO_TAG = 'vemotion';
export const VEMOTION_AUDIO_VOICEOVER_TAG = 'voice-over';
export const VEMOTION_AUDIO_CATEGORY = 'Vemotion';

export interface AudioRecording {
  recordingId?: string;
  userEmail?: string;
  fileName?: string;
  displayName?: string;
  r2Key?: string;
  r2Url: string;
  fileSize?: number;
  duration?: number;
  tags?: string[];
  category?: string;
  audioFormat?: string;
  createdAt?: string;
}

interface UploadResult {
  audioUrl: string;
  r2Key: string;
}

/**
 * Upload a recorded blob to R2 via the transcription worker. Returns the
 * public audioUrl and the r2Key. Same shape Contacts uses.
 */
export async function uploadAudioBlob(blob: Blob, fileName: string): Promise<UploadResult> {
  const res = await fetch(`${TRANSCRIPTION_WORKER}/upload`, {
    method: 'POST',
    headers: { 'X-File-Name': encodeURIComponent(fileName) },
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`Audio upload failed: HTTP ${res.status}`);
  }
  const data = await res.json() as { audioUrl?: string; r2Key?: string };
  if (!data.audioUrl) throw new Error('Audio upload returned no audioUrl');
  return { audioUrl: data.audioUrl, r2Key: data.r2Key ?? '' };
}

/**
 * Register a recording in the audio portfolio's metadata KV. Best-effort —
 * Contacts wraps this in try/catch and ignores failures because the upload
 * itself already succeeded and the URL is usable. We follow the same pattern.
 */
export async function saveRecordingMetadata(payload: AudioRecording & { userEmail: string }): Promise<void> {
  try {
    await fetch(`${PORTFOLIO_WORKER}/save-recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Email': payload.userEmail },
      body: JSON.stringify({
        userEmail: payload.userEmail,
        fileName: payload.fileName,
        displayName: payload.displayName,
        r2Key: payload.r2Key ?? '',
        r2Url: payload.r2Url,
        fileSize: payload.fileSize ?? 0,
        duration: payload.duration ?? 0,
        tags: payload.tags ?? [],
        category: payload.category,
        audioFormat: payload.audioFormat ?? 'webm',
      }),
    });
  } catch {
    /* swallow — upload already succeeded; metadata is nice-to-have */
  }
}

/**
 * List the user's recordings filtered to Vemotion-tagged ones. The portfolio
 * worker returns ALL of the user's recordings; we filter client-side so
 * voice notes from Contacts etc. don't pollute the Vemotion picker (matches
 * the user's pick-from-portfolio = "Only Vemotion" choice).
 */
export async function listVemotionRecordings(userEmail: string): Promise<AudioRecording[]> {
  // Explicit limit — the worker's default behaviour without `limit` was
  // observed (2026-05-29) to return only 4 recordings for a user with
  // 8 in /list-recordings-public. The OpenAPI documents `limit: default 50`
  // but the actual response disagreed. Hard-coding 200 keeps the picker
  // from silently hiding tagged recordings beyond the first short page
  // until the underlying worker default is investigated.
  const res = await fetch(
    `${PORTFOLIO_WORKER}/list-recordings?userEmail=${encodeURIComponent(userEmail)}&limit=200`,
  );
  if (!res.ok) {
    throw new Error(`Audio list failed: HTTP ${res.status}`);
  }
  const data = await res.json() as { recordings?: AudioRecording[] };
  const all = data.recordings ?? [];
  return all.filter(r => (r.tags ?? []).includes(VEMOTION_AUDIO_TAG));
}
