import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Trash2, Eye, EyeOff, ExternalLink, RefreshCw } from 'lucide-react';
import {
  listAcademyVideos,
  updateTrainingMeta,
  deleteTrainingVideo,
  type AcademyVideo,
  type Audience,
} from '../lib/trainingVideo';

interface TrainingVideosModalProps {
  onClose: () => void;
}

type StatusFilter = 'all' | 'draft' | 'published';

// ── datetime-local <-> ISO helpers ─────────────────────────────────────────
// <input type="datetime-local"> works in LOCAL time with no timezone; the API
// stores ISO (UTC). Convert both ways so the picker round-trips correctly.
function isoToLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function audienceSummary(a: Audience): string {
  if (a.mode === 'all') return 'Everyone';
  if (a.mode === 'founders') return 'All World Founders';
  return `${a.list.length} specific ${a.list.length === 1 ? 'person' : 'people'}`;
}

interface RowDraft {
  audienceMode: Audience['mode'];
  emails: string; // newline/comma separated
  releaseAt: string; // ISO
  endAt: string; // ISO
}

function draftFromVideo(v: AcademyVideo): RowDraft {
  return {
    audienceMode: v.audience.mode,
    emails: v.audience.mode === 'emails' ? v.audience.list.join('\n') : '',
    releaseAt: v.releaseAt,
    endAt: v.endAt,
  };
}

export default function TrainingVideosModal({ onClose }: TrainingVideosModalProps) {
  const [videos, setVideos] = useState<AcademyVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listAcademyVideos(true);
      setVideos(list);
      setDrafts(Object.fromEntries(list.map((v) => [v.key, draftFromVideo(v)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load training videos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(
    () => videos.filter((v) => filter === 'all' || v.status === filter),
    [videos, filter],
  );

  const patchDraft = (key: string, patch: Partial<RowDraft>) =>
    setDrafts((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  const togglePublish = async (v: AcademyVideo) => {
    setBusyKey(v.key);
    setError(null);
    try {
      const next = v.status === 'published' ? 'draft' : 'published';
      await updateTrainingMeta(v.key, { status: next });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change status.');
    } finally {
      setBusyKey(null);
    }
  };

  const saveTargeting = async (v: AcademyVideo) => {
    const d = drafts[v.key];
    if (!d) return;
    setBusyKey(v.key);
    setError(null);
    try {
      let audience: Audience;
      if (d.audienceMode === 'emails') {
        const list = d.emails
          .split(/[\n,]/)
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e.includes('@'));
        audience = { mode: 'emails', list };
      } else {
        audience = { mode: d.audienceMode } as Audience;
      }
      await updateTrainingMeta(v.key, {
        audience,
        releaseAt: d.releaseAt,
        endAt: d.endAt,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save targeting.');
    } finally {
      setBusyKey(null);
    }
  };

  const remove = async (v: AcademyVideo) => {
    if (!window.confirm(`Delete "${v.title}"? This permanently removes the video from the Academy.`)) return;
    setBusyKey(v.key);
    setError(null);
    try {
      await deleteTrainingVideo(v.key);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete.');
    } finally {
      setBusyKey(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-4xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Training Videos</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Manage which Academy videos World Founders can see. Drafts and out-of-window videos are hidden from the Learn tab.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-2 px-6 pt-4">
          {(['all', 'draft', 'published'] as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs font-medium rounded-full px-3 py-1 transition capitalize ${
                filter === f
                  ? 'bg-sky-600 text-slate-900 dark:text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="p-6 overflow-y-auto space-y-3">
          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-slate-500 dark:text-slate-400" />
            </div>
          )}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          {!loading && shown.length === 0 && (
            <p className="text-slate-500 dark:text-slate-400 text-sm py-8 text-center">No training videos{filter !== 'all' ? ` (${filter})` : ''}.</p>
          )}

          {shown.map((v) => {
            const d = drafts[v.key];
            const busy = busyKey === v.key;
            return (
              <div key={v.key} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100/60 dark:bg-slate-800/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900 dark:text-white truncate">{v.title}</span>
                      <span
                        className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${
                          v.status === 'published'
                            ? 'bg-emerald-900/60 text-emerald-300'
                            : 'bg-amber-900/60 text-amber-300'
                        }`}
                      >
                        {v.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {audienceSummary(v.audience)}
                      {v.releaseAt && ` · from ${new Date(v.releaseAt).toLocaleString()}`}
                      {v.endAt && ` · until ${new Date(v.endAt).toLocaleString()}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={v.playUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white p-1.5"
                      title="Open video"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                    <button
                      onClick={() => togglePublish(v)}
                      disabled={busy}
                      className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white p-1.5 disabled:opacity-50"
                      title={v.status === 'published' ? 'Unpublish (back to draft)' : 'Publish'}
                    >
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : v.status === 'published' ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => remove(v)}
                      disabled={busy}
                      className="text-red-400 hover:text-red-300 p-1.5 disabled:opacity-50"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Targeting editor */}
                {d && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="text-xs text-slate-500 dark:text-slate-400">
                      Audience
                      <select
                        value={d.audienceMode}
                        onChange={(e) => patchDraft(v.key, { audienceMode: e.target.value as Audience['mode'] })}
                        className="mt-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-sm text-slate-900 dark:text-slate-200"
                      >
                        <option value="all">Everyone</option>
                        <option value="founders">All World Founders</option>
                        <option value="emails">Specific people</option>
                      </select>
                    </label>
                    <label className="text-xs text-slate-500 dark:text-slate-400">
                      Release date
                      <input
                        type="datetime-local"
                        value={isoToLocalInput(d.releaseAt)}
                        onChange={(e) => patchDraft(v.key, { releaseAt: localInputToIso(e.target.value) })}
                        className="mt-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-sm text-slate-900 dark:text-slate-200"
                      />
                    </label>
                    <label className="text-xs text-slate-500 dark:text-slate-400">
                      End date
                      <input
                        type="datetime-local"
                        value={isoToLocalInput(d.endAt)}
                        onChange={(e) => patchDraft(v.key, { endAt: localInputToIso(e.target.value) })}
                        className="mt-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-sm text-slate-900 dark:text-slate-200"
                      />
                    </label>
                    {d.audienceMode === 'emails' && (
                      <label className="text-xs text-slate-500 dark:text-slate-400 md:col-span-3">
                        Emails (one per line or comma-separated)
                        <textarea
                          value={d.emails}
                          onChange={(e) => patchDraft(v.key, { emails: e.target.value })}
                          rows={3}
                          placeholder="founder@example.com"
                          className="mt-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-sm text-slate-900 dark:text-slate-200 font-mono"
                        />
                      </label>
                    )}
                    <div className="md:col-span-3 flex justify-end">
                      <button
                        onClick={() => saveTargeting(v)}
                        disabled={busy}
                        className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-200 dark:disabled:bg-slate-700 text-slate-900 dark:text-white text-sm font-medium rounded-lg px-4 py-1.5 transition flex items-center gap-2"
                      >
                        {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save targeting
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
