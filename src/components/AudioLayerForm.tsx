import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2, Volume2, Library } from 'lucide-react';
import type { Layer } from '../lib/api';
import { readStoredUser } from '../lib/auth';
import {
  listVemotionRecordings,
  saveRecordingMetadata,
  uploadAudioBlob,
  VEMOTION_AUDIO_CATEGORY,
  VEMOTION_AUDIO_TAG,
  VEMOTION_AUDIO_VOICEOVER_TAG,
  type AudioRecording,
} from '../lib/audioPortfolio';

interface AudioLayerFormProps {
  onAdd: (layer: Layer) => void;
  compositionDuration: number;
  editingLayer?: Layer;
}

type Mode = 'record' | 'pick';

const generateId = () => `layer-${Date.now().toString(36)}`;

/**
 * Audio-tab content for AddLayerModal.
 *
 * Two modes:
 *   - 'record' (default): captures mic via MediaRecorder → uploads to the
 *     transcription-worker /upload → registers metadata in audio-portfolio
 *     /save-recording → builds the layer with the returned r2Url. Same
 *     pattern Contacts uses (verified path).
 *   - 'pick': lists the user's already-saved Vemotion-tagged recordings
 *     from /list-recordings and lets them attach one without re-recording.
 *
 * Common per-layer fields: volume (0–1), startTime (sec), layerDuration (sec).
 */
export const AudioLayerForm: React.FC<AudioLayerFormProps> = ({ onAdd, compositionDuration, editingLayer }) => {
  const [mode, setMode] = useState<Mode>('record');

  // Editing pre-fills from existing layer.
  const editingProps = (editingLayer?.properties ?? {}) as Record<string, unknown>;

  // Common per-layer state
  const [displayName, setDisplayName] = useState<string>((editingProps.displayName as string) ?? '');
  const [volume, setVolume] = useState<number>(typeof editingProps.volume === 'number' ? editingProps.volume as number : 1);
  const [startTime, setStartTime] = useState<number>(editingLayer?.startTime ?? 0);
  const [layerDuration, setLayerDuration] = useState<number>(editingLayer?.layerDuration ?? compositionDuration);

  // Selected audio source (after recording or picking)
  const [r2Url, setR2Url] = useState<string>((editingProps.r2Url as string) ?? '');
  const [r2Key, setR2Key] = useState<string>((editingProps.r2Key as string) ?? '');
  const [sourceDuration, setSourceDuration] = useState<number | null>(typeof editingProps.duration === 'number' ? editingProps.duration as number : null);

  // Recording state
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Pick-mode state
  const [recordings, setRecordings] = useState<AudioRecording[]>([]);
  const [pickLoading, setPickLoading] = useState(false);
  const [pickError, setPickError] = useState('');

  const userEmail = readStoredUser()?.email;

  // ── Pick mode: fetch list when entered ───────────────────────────────────────
  useEffect(() => {
    if (mode !== 'pick' || !userEmail) return;
    setPickLoading(true);
    setPickError('');
    listVemotionRecordings(userEmail)
      .then(setRecordings)
      .catch((e: unknown) => setPickError(e instanceof Error ? e.message : 'Failed to load recordings'))
      .finally(() => setPickLoading(false));
  }, [mode, userEmail]);

  // ── Recording control ────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setError('');
    setStatus('Requesting mic…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setUploading(true);
        setStatus(`Uploading ${(blob.size / 1024).toFixed(0)} KB…`);
        try {
          const fileName = `vemotion-vo-${Date.now()}.webm`;
          const { audioUrl, r2Key: returnedKey } = await uploadAudioBlob(blob, fileName);
          setR2Url(audioUrl);
          setR2Key(returnedKey);

          // Probe duration via a temporary Audio element.
          const probe = new Audio(audioUrl);
          await new Promise<void>(resolve => {
            probe.addEventListener('loadedmetadata', () => resolve(), { once: true });
            probe.addEventListener('error', () => resolve(), { once: true });
          });
          const probedDuration = Number.isFinite(probe.duration) ? probe.duration : 0;
          setSourceDuration(probedDuration);
          if (probedDuration > 0 && layerDuration === compositionDuration) {
            // First-time autofill: shrink layerDuration to fit the recording
            setLayerDuration(probedDuration);
          }

          // Best-effort metadata save (Contacts pattern: ignore failures)
          if (userEmail) {
            const niceName = displayName.trim() || `Vemotion VO — ${new Date().toLocaleString()}`;
            await saveRecordingMetadata({
              userEmail,
              fileName,
              displayName: niceName,
              r2Key: returnedKey,
              r2Url: audioUrl,
              fileSize: blob.size,
              duration: probedDuration,
              tags: [VEMOTION_AUDIO_TAG, VEMOTION_AUDIO_VOICEOVER_TAG],
              category: VEMOTION_AUDIO_CATEGORY,
              audioFormat: 'webm',
            });
            if (!displayName.trim()) setDisplayName(niceName);
          }
          setStatus('Recording saved ✓ — review and Add as Layer');
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Upload failed');
          setStatus('');
        } finally {
          setUploading(false);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setStatus('Recording…');
    } catch (e) {
      setError('Microphone access denied: ' + (e instanceof Error ? e.message : String(e)));
      setStatus('');
    }
  }, [compositionDuration, displayName, layerDuration, userEmail]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setRecording(false);
  }, []);

  // ── Build + commit layer ────────────────────────────────────────────────────
  const handleAdd = () => {
    if (!r2Url) { setError('Pick or record an audio source first.'); return; }
    const props: Record<string, unknown> = {
      r2Url,
      ...(r2Key ? { r2Key } : {}),
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      ...(sourceDuration ? { duration: sourceDuration } : {}),
      volume,
    };
    const layer: Layer = {
      id: editingLayer?.id ?? generateId(),
      type: 'audio',
      // position/size are unused by the renderer for audio but the schema
      // requires them. Use stable defaults.
      position: editingLayer?.position ?? { x: 0, y: 0 },
      size:     editingLayer?.size     ?? { width: 0, height: 0 },
      startTime,
      layerDuration,
      properties: props,
    };
    onAdd(layer);
  };

  return (
    <div className="space-y-4">
      {/* Mode tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode('record')}
          className={[
            'flex-1 py-2 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2',
            mode === 'record' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700',
          ].join(' ')}
        >
          <Mic className="w-4 h-4" />
          Record new
        </button>
        <button
          onClick={() => setMode('pick')}
          className={[
            'flex-1 py-2 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2',
            mode === 'pick' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700',
          ].join(' ')}
        >
          <Library className="w-4 h-4" />
          Pick from portfolio
        </button>
      </div>

      {/* RECORD MODE */}
      {mode === 'record' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {!recording ? (
              <button
                onClick={() => void startRecording()}
                disabled={uploading || !userEmail}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-slate-700 text-white rounded-lg text-sm font-medium transition"
              >
                <Mic className="w-4 h-4" /> Start recording
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition"
              >
                <Square className="w-4 h-4 fill-current" /> Stop
              </button>
            )}
            {(uploading || recording) && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
            {!userEmail && <span className="text-xs text-amber-400">Sign in to save recordings</span>}
          </div>
          {status && <p className="text-xs text-slate-400">{status}</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}
          {r2Url && (
            <audio src={r2Url} controls className="w-full h-10" />
          )}
        </div>
      )}

      {/* PICK MODE */}
      {mode === 'pick' && (
        <div className="space-y-2">
          {!userEmail && <p className="text-xs text-amber-400">Sign in to load your portfolio.</p>}
          {pickLoading && <p className="text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading recordings…</p>}
          {pickError && <p className="text-xs text-red-400">{pickError}</p>}
          {!pickLoading && !pickError && recordings.length === 0 && userEmail && (
            <p className="text-xs text-slate-500">No Vemotion-tagged recordings yet. Switch to <em>Record new</em> to make one — it'll be tagged automatically and appear here next time.</p>
          )}
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {recordings.map(r => {
              const active = r.r2Url === r2Url;
              return (
                <div
                  key={r.r2Url}
                  className={[
                    'flex items-center justify-between gap-2 p-2 rounded-lg cursor-pointer transition border',
                    active ? 'bg-sky-600/15 border-sky-500/50' : 'bg-slate-800 hover:bg-slate-700 border-transparent',
                  ].join(' ')}
                  onClick={() => {
                    setR2Url(r.r2Url);
                    setR2Key(r.r2Key ?? '');
                    setSourceDuration(r.duration ?? null);
                    if (!displayName.trim() && r.displayName) setDisplayName(r.displayName);
                    if (r.duration && layerDuration === compositionDuration) {
                      setLayerDuration(r.duration);
                    }
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-200 truncate">{r.displayName || r.fileName || '(unnamed)'}</p>
                    <p className="text-xs text-slate-500">
                      {r.duration ? `${r.duration.toFixed(1)}s · ` : ''}
                      {r.audioFormat ?? 'webm'}
                      {r.createdAt ? ` · ${new Date(r.createdAt).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                  <audio src={r.r2Url} controls className="h-8 w-44 flex-shrink-0" onClick={e => e.stopPropagation()} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* COMMON PER-LAYER SETTINGS */}
      <div className="border-t border-slate-800 pt-3 space-y-3">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Display name (optional)</label>
          <input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="e.g. Opening narration"
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div>
          <label className="text-xs text-slate-400 mb-1 block flex items-center gap-1">
            <Volume2 className="w-3 h-3" /> Volume: {Math.round(volume * 100)}%
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={e => setVolume(parseFloat(e.target.value))}
            className="w-full accent-sky-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Start time (s)</label>
            <input
              type="number"
              min={0}
              step={0.1}
              value={startTime}
              onChange={e => setStartTime(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Duration (s)</label>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={layerDuration}
              onChange={e => setLayerDuration(parseFloat(e.target.value) || compositionDuration)}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        </div>
        {sourceDuration && (
          <p className="text-xs text-slate-500">
            Source recording is {sourceDuration.toFixed(1)} s. The layer plays from the source's start; if Duration is shorter than source, audio is cut at Duration. If longer, audio plays once then stays silent until layer end.
          </p>
        )}

        <button
          onClick={handleAdd}
          disabled={!r2Url}
          className="w-full bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 text-white font-semibold rounded-lg py-3 transition"
        >
          {editingLayer ? 'Save Changes' : 'Add as Layer'}
        </button>
      </div>
    </div>
  );
};
