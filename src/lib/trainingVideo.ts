/**
 * Save an exported MP4 as a training (academy) video in the realtime videos.
 *
 * Drives the realtime-worker multipart upload (init → part → complete) and lands
 * the file at `recordings/academy/<name>` in the `meeting-recordings` R2 bucket —
 * exactly where the MyPage "Learn" tab lists training videos
 * (`list-meeting-recordings?prefix=recordings/academy/`). The init call tags the
 * object with `folder: 'academy'`, a `title`, and `labels: 'academy'`.
 *
 * The upload routes are Superadmin-gated, so the stored user must be a Superadmin.
 */

import { readStoredUser } from './auth';

const REALTIME_API = 'https://api.vegvisr.org/realtime';
const PART_SIZE = 10 * 1024 * 1024; // 10 MB chunks

export interface TrainingUploadProgress {
  stage: 'uploading' | 'finalising' | 'done';
  percent: number;
  message: string;
}

export interface TrainingUploadResult {
  key: string;
  playUrl: string;
  name: string;
}

function slugFilename(title: string): string {
  const base =
    (title || 'vemotion-training')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'vemotion-training';
  return `${base}.mp4`;
}

export async function saveAsTrainingVideo(
  blob: Blob,
  title: string,
  onProgress?: (p: TrainingUploadProgress) => void,
): Promise<TrainingUploadResult> {
  const token = readStoredUser()?.emailVerificationToken;
  if (!token) throw new Error('Not authenticated');
  const auth = { 'X-API-Token': token };
  const filename = slugFilename(title);

  // 1. init — creates the multipart session under recordings/academy/<name>
  const initRes = await fetch(`${REALTIME_API}/recordings/upload/init`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename,
      contentType: 'video/mp4',
      size: blob.size,
      folder: 'academy',
      title,
      labels: 'academy',
    }),
  });
  const initData = (await initRes.json().catch(() => ({}))) as {
    uploadId?: string;
    key?: string;
    error?: string;
  };
  if (!initRes.ok || !initData.uploadId || !initData.key) {
    throw new Error(initData.error || `Upload init failed (HTTP ${initRes.status})`);
  }
  const { uploadId, key } = initData;

  const totalParts = Math.max(1, Math.ceil(blob.size / PART_SIZE));
  const parts: { partNumber: number; etag: string }[] = [];

  try {
    // 2. parts — stream each chunk through the worker to R2
    for (let i = 0; i < totalParts; i++) {
      const partNumber = i + 1;
      const chunk = blob.slice(i * PART_SIZE, Math.min(blob.size, (i + 1) * PART_SIZE));
      const url =
        `${REALTIME_API}/recordings/upload/part` +
        `?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`;
      const partRes = await fetch(url, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/octet-stream' },
        body: chunk,
      });
      const partData = (await partRes.json().catch(() => ({}))) as {
        part?: { partNumber: number; etag: string };
        error?: string;
      };
      if (!partRes.ok || !partData.part) {
        throw new Error(partData.error || `Part ${partNumber} failed (HTTP ${partRes.status})`);
      }
      parts.push({ partNumber: partData.part.partNumber, etag: partData.part.etag });
      onProgress?.({
        stage: 'uploading',
        percent: Math.round((partNumber / totalParts) * 90),
        message: `Uploading ${partNumber}/${totalParts}…`,
      });
    }

    // 3. complete
    onProgress?.({ stage: 'finalising', percent: 95, message: 'Finalising…' });
    const compRes = await fetch(`${REALTIME_API}/recordings/upload/complete`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, uploadId, parts, name: filename, size: blob.size, contentType: 'video/mp4' }),
    });
    const compData = (await compRes.json().catch(() => ({}))) as {
      playUrl?: string;
      name?: string;
      error?: string;
    };
    if (!compRes.ok || !compData.playUrl) {
      throw new Error(compData.error || `Upload complete failed (HTTP ${compRes.status})`);
    }
    onProgress?.({ stage: 'done', percent: 100, message: 'Saved to Academy.' });
    return { key, playUrl: compData.playUrl, name: compData.name || filename };
  } catch (err) {
    // Best-effort cleanup of the interrupted multipart upload.
    try {
      await fetch(`${REALTIME_API}/recordings/upload/abort`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, uploadId }),
      });
    } catch {
      /* ignore */
    }
    throw err;
  }
}
