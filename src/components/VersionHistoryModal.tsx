import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, RotateCcw, Loader2 } from 'lucide-react';
import {
  getCompositionHistory,
  getCompositionVersion,
  type CompositionVersionSummary,
} from '../lib/cloud-compositions';
import type { CompositionData } from '../lib/api';

interface Props {
  compositionId: string;
  currentVersion: number;
  onClose: () => void;
  onRestore: (composition: CompositionData) => void;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export const VersionHistoryModal: React.FC<Props> = ({
  compositionId,
  currentVersion,
  onClose,
  onRestore,
}) => {
  const [versions, setVersions] = useState<CompositionVersionSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    getCompositionHistory(compositionId)
      .then((list) => {
        if (cancelled) return;
        setVersions(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load history.');
      });
    return () => { cancelled = true; };
  }, [compositionId]);

  const handleRestore = async (version: number) => {
    setRestoringVersion(version);
    setRestoreError(null);
    try {
      const data = await getCompositionVersion(compositionId, version);
      onRestore(data.composition);
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Failed to restore.');
      setRestoringVersion(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Version history</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Last 30 autosaves. Click Restore to load one.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loadError && (
            <div className="text-sm text-rose-600 dark:text-rose-300 bg-rose-500/10 border border-rose-400/20 rounded-xl px-4 py-3 mb-3">
              {loadError}
            </div>
          )}
          {!versions && !loadError && (
            <div className="flex items-center justify-center py-12 text-slate-500 dark:text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          )}
          {versions && versions.length === 0 && (
            <div className="text-center text-slate-500 dark:text-slate-400 py-12 text-sm">
              No saved versions yet.
            </div>
          )}
          {versions && versions.length > 0 && (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {versions.map((v) => {
                const isCurrent = v.version === currentVersion;
                const isRestoring = restoringVersion === v.version;
                return (
                  <li key={v.version} className="py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900 dark:text-white">
                          v{v.version}
                        </span>
                        {isCurrent && (
                          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                            current
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {fmtTime(v.updatedAt)} · {v.layerCount} layer{v.layerCount === 1 ? '' : 's'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestore(v.version)}
                      disabled={isCurrent || restoringVersion !== null}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                      title={isCurrent ? 'Already loaded' : `Restore v${v.version}`}
                    >
                      {isRestoring ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5" />
                      )}
                      Restore
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {restoreError && (
            <div className="text-sm text-rose-600 dark:text-rose-300 bg-rose-500/10 border border-rose-400/20 rounded-xl px-4 py-3 mt-3">
              {restoreError}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
