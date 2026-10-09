/**
 * Pick photos in Google Photos and get them back as Files.
 *
 * Reuses the ecosystem's Google sign-in on auth.vegvisr.org (Lesson 22) — the same
 * routes www.vegvisr.org and photos.vegvisr.org use:
 *   /picker/auth            Google consent; the worker stores the tokens under the user's email
 *   /picker/get-credentials hands a current access token to its owner (the worker renews it)
 *   /picker/proxy-image     fetches the media bytes (Google's media hosts send no CORS headers)
 * The choosing itself happens in Google's own picker window — the Picker API gives an app
 * access only to the items the user picks there, never to the library.
 *
 * Same flow as photos-vegvisr's GooglePhotosImport.tsx; keep the two in step.
 */
import { readStoredUser } from './auth';

const AUTH_WORKER_BASE = 'https://auth.vegvisr.org';
const PICKER_API_BASE = 'https://photospicker.googleapis.com/v1';
const POPUP_NAME = 'vegvisr-google-photos';
const AUTH_CHANNEL = 'vegvisr-picker-auth';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_PICK_TIMEOUT_MS = 15 * 60 * 1000;
// Google's size parameters top out here; used when a HEIC original is converted to JPEG.
const MAX_GOOGLE_DIMENSION = 16383;

export type GooglePhotosPhase = 'opening' | 'connecting' | 'choosing' | 'downloading';

export interface GooglePhotosProgress {
  phase: GooglePhotosPhase;
  /** Set while choosing: the picker link, for when the window did not open. */
  pickerUri?: string;
  done?: number;
  total?: number;
}

export interface GooglePhotosResult {
  files: File[];
  /** One line per picked item that was not returned, with the reason. */
  skipped: string[];
}

interface PickedMediaItem {
  id: string;
  type?: string;
  mediaFile?: {
    baseUrl?: string;
    mimeType?: string;
    filename?: string;
    mediaFileMetadata?: { width?: number; height?: number };
  };
}

interface PickerSession {
  id: string;
  pickerUri?: string;
  mediaItemsSet?: boolean;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
}

interface AuthMessage { type?: string; success?: boolean; email?: string; error?: string }

export class GooglePhotosCancelled extends Error {}
class GoogleAuthExpired extends Error {}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Picker API durations arrive as protobuf strings, e.g. "5s" or "1800.5s". */
const parseDurationMs = (value: string | undefined, fallback: number) => {
  const seconds = value ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallback;
};

const replaceExtension = (filename: string, extension: string) =>
  `${filename.replace(/\.[^./\\]+$/, '')}.${extension}`;

/**
 * Open the window the whole flow runs in. Call this synchronously inside the click
 * handler, before any await — otherwise the browser's popup blocker stops it.
 */
export const openGooglePhotosWindow = (): Window | null =>
  window.open('', POPUP_NAME, 'width=1000,height=760');

/** What the caller can use. Google's picker cannot filter by type, so the other kind is skipped. */
export type GooglePhotosKind = 'photos' | 'video';

/**
 * Runs sign-in (only when needed), the Google picker, and the download of the picked
 * items. `kind: 'photos'` (default) returns photos and skips videos; `kind: 'video'`
 * limits the picker to ONE item and returns it as an MP4, skipping photos.
 * Throws GooglePhotosCancelled when `isCancelled()` turns true.
 */
export async function pickFromGooglePhotos(
  popup: Window,
  onProgress: (progress: GooglePhotosProgress) => void,
  isCancelled: () => boolean,
  kind: GooglePhotosKind = 'photos',
): Promise<GooglePhotosResult> {
  const user = readStoredUser();
  const apiToken = user?.emailVerificationToken;
  const userEmail = user?.email;
  if (!apiToken || !userEmail) throw new Error('Not authenticated');

  const authHeaders = { 'Content-Type': 'application/json', 'X-API-Token': apiToken };
  const credentialsBody = JSON.stringify({ user_email: userEmail });
  let channel: BroadcastChannel | null = null;

  const assertActive = () => {
    if (isCancelled()) throw new GooglePhotosCancelled('Cancelled');
  };
  const broadcast = (message: Record<string, unknown>) => {
    try {
      channel?.postMessage(message);
    } catch {
      // The channel is a convenience for the popup; the flow does not depend on it.
    }
  };

  /** The stored Google access token, or null when the user has to sign in. */
  const fetchAccessToken = async (): Promise<string | null> => {
    const res = await fetch(`${AUTH_WORKER_BASE}/picker/get-credentials`, {
      method: 'POST', headers: authHeaders, body: credentialsBody,
    });
    if (res.status === 404 || res.status === 410) return null;
    const data = await res.json().catch(() => null) as { access_token?: string; error?: string } | null;
    if (!res.ok) throw new Error(data?.error || `Could not read Google credentials (${res.status}).`);
    return data?.access_token || null;
  };

  /**
   * Sends the popup through Google sign-in and resolves with the new access token. The
   * return page reports over the BroadcastChannel; polling get-credentials is the backstop
   * for when that page never loads.
   */
  const signIn = async (): Promise<string> => {
    onProgress({ phase: 'connecting' });
    let reported: AuthMessage | null = null;
    channel?.close();
    try {
      channel = new BroadcastChannel(AUTH_CHANNEL);
      channel.onmessage = (event: MessageEvent<AuthMessage>) => {
        if (event.data?.type === 'picker-auth') reported = event.data;
      };
    } catch {
      channel = null;
    }

    const returnUrl = `${window.location.origin}/picker-return.html`;
    popup.location.href = `${AUTH_WORKER_BASE}/picker/auth?return_url=${encodeURIComponent(returnUrl)}`;

    const deadline = Date.now() + AUTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(2500);
      assertActive();
      const message = reported as AuthMessage | null;
      if (message) {
        if (!message.success) throw new Error(`Google sign-in failed: ${message.error || 'no result returned'}`);
        // Credentials are stored under the Google email and handed out only to the Vegvisr
        // account with that same email, so a different Google account can never be read back.
        if (message.email && message.email.toLowerCase() !== userEmail.toLowerCase()) {
          const text = `You signed in to Google as ${message.email}, but your Vegvisr account is ${userEmail}. Sign in with the Google account that matches.`;
          broadcast({ type: 'picker-close', message: text, error: true });
          throw new Error(text);
        }
      }
      const token = await fetchAccessToken();
      if (token) return token;
      if (message) throw new Error('Google sign-in completed, but no credentials were stored. Try again.');
    }
    throw new Error('Google sign-in timed out. Try again.');
  };

  const createSession = async (accessToken: string): Promise<PickerSession> => {
    const res = await fetch(`${PICKER_API_BASE}/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      // A video layer takes one clip, so the picker stops at one (int64 travels as a string).
      body: JSON.stringify(kind === 'video' ? { pickingConfig: { maxItemCount: '1' } } : {}),
    });
    if (res.status === 401) throw new GoogleAuthExpired('Google session expired.');
    if (!res.ok) throw new Error(`Google Photos refused to open a picker session (${res.status}).`);
    const session = await res.json() as PickerSession;
    if (!session.id || !session.pickerUri) throw new Error('Google Photos returned no picker link.');
    return session;
  };

  /** Downloads one picked item at original quality and wraps it as an uploadable File. */
  const downloadItem = async (item: PickedMediaItem, index: number): Promise<File> => {
    const media = item.mediaFile;
    if (!media?.baseUrl) throw new Error('no download link');
    const mimeType = media.mimeType || '';
    const isVideo = item.type === 'VIDEO' || mimeType.startsWith('video/');
    if (isVideo && kind === 'photos') {
      throw new Error('videos are not imported here — add a video from the Video tab');
    }
    if (!isVideo && kind === 'video') {
      throw new Error('that is a photo — add photos from the Images tab');
    }
    const isHeic = /image\/hei[cf]/i.test(mimeType);
    let filename = media.filename || `google-photos-${Date.now()}-${index + 1}.${isVideo ? 'mp4' : 'jpg'}`;
    let suffix = '=d';
    if (isVideo) {
      // =dv is Google's transcoded MP4, whatever container the original was in.
      suffix = '=dv';
      filename = replaceExtension(filename, 'mp4');
    } else if (isHeic) {
      // Browsers cannot display HEIC. A sized request makes Google serve a JPEG instead.
      const width = Math.min(media.mediaFileMetadata?.width || MAX_GOOGLE_DIMENSION, MAX_GOOGLE_DIMENSION);
      const height = Math.min(media.mediaFileMetadata?.height || MAX_GOOGLE_DIMENSION, MAX_GOOGLE_DIMENSION);
      suffix = `=w${width}-h${height}`;
      filename = replaceExtension(filename, 'jpg');
    }
    const res = await fetch(`${AUTH_WORKER_BASE}/picker/proxy-image`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ baseUrl: `${media.baseUrl}${suffix}`, user_email: userEmail }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(data?.error || `download failed (${res.status})`);
    }
    const blob = await res.blob();
    if (blob.size === 0) throw new Error('empty file');
    const type = isVideo ? 'video/mp4' : isHeic ? 'image/jpeg' : blob.type || mimeType || 'image/jpeg';
    return new File([blob], filename, { type });
  };

  let sessionId = '';
  let accessToken = '';
  try {
    onProgress({ phase: 'opening' });
    let signedInNow = false;
    let token = await fetchAccessToken();
    assertActive();
    if (!token) {
      token = await signIn();
      signedInNow = true;
    }

    let session: PickerSession;
    try {
      session = await createSession(token);
    } catch (err) {
      // A stored token Google no longer accepts: sign in once more, then retry.
      if (!(err instanceof GoogleAuthExpired) || signedInNow) throw err;
      // Drop the dead token first, or the sign-in wait would read it straight back.
      await fetch(`${AUTH_WORKER_BASE}/picker/delete-credentials`, {
        method: 'POST', headers: authHeaders, body: credentialsBody,
      });
      token = await signIn();
      session = await createSession(token);
    }
    assertActive();
    accessToken = token;
    sessionId = session.id;

    // /autoclose makes Google close its window once the user presses Done.
    const uri = `${session.pickerUri}/autoclose`;
    onProgress({ phase: 'choosing', pickerUri: uri });
    // Two routes to the same navigation: directly, while this page still holds the window;
    // and via the return page, which listens for it when Google's sign-in pages have cut
    // that link. The caller also shows the link for the case where neither lands.
    try {
      if (!popup.closed) popup.location.href = uri;
    } catch {
      // Fall through to the broadcast and the manual link.
    }
    broadcast({ type: 'picker-navigate', url: uri });

    const interval = Math.max(parseDurationMs(session.pollingConfig?.pollInterval, 3000), 2000);
    const deadline = Date.now() + parseDurationMs(session.pollingConfig?.timeoutIn, DEFAULT_PICK_TIMEOUT_MS);
    let picked = false;
    while (!picked && Date.now() < deadline) {
      await sleep(interval);
      assertActive();
      const res = await fetch(`${PICKER_API_BASE}/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Could not check the Google Photos picker (${res.status}).`);
      picked = Boolean((await res.json() as PickerSession).mediaItemsSet);
    }
    if (!picked) throw new Error('No selection was made in Google Photos before the picker timed out.');

    const items: PickedMediaItem[] = [];
    let pageToken = '';
    do {
      const url = new URL(`${PICKER_API_BASE}/mediaItems`);
      url.searchParams.set('sessionId', sessionId);
      url.searchParams.set('pageSize', '100');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error(`Could not read the selected items (${res.status}).`);
      const data = await res.json() as { mediaItems?: PickedMediaItem[]; nextPageToken?: string };
      items.push(...(data.mediaItems || []));
      pageToken = data.nextPageToken || '';
      assertActive();
    } while (pageToken);
    if (items.length === 0) throw new Error('Nothing was selected in Google Photos.');

    const files: File[] = [];
    const skipped: string[] = [];
    onProgress({ phase: 'downloading', done: 0, total: items.length });
    for (const [index, item] of items.entries()) {
      assertActive();
      try {
        files.push(await downloadItem(item, index));
      } catch (err) {
        const label = item.mediaFile?.filename || `item ${index + 1}`;
        skipped.push(`${label}: ${err instanceof Error ? err.message : 'download failed'}`);
      }
      onProgress({ phase: 'downloading', done: index + 1, total: items.length });
    }
    return { files, skipped };
  } catch (err) {
    // Best effort: the handle is dead once Google's pages have cut the opener link, and
    // the return page then shows its own "you can close this window".
    broadcast({ type: 'picker-close' });
    try {
      popup.close();
    } catch {
      // Nothing to do.
    }
    throw err;
  } finally {
    // Sessions are single-use. Google asks for them to be deleted once the bytes are fetched.
    if (sessionId && accessToken) {
      fetch(`${PICKER_API_BASE}/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => undefined);
    }
    (channel as BroadcastChannel | null)?.close();
  }
}
