import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, FolderOpen, Trash2, RefreshCw, LayoutTemplate } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import {
  listTemplates,
  cloneTemplate,
  unpublishTemplate,
  type TemplateSummary,
} from '../lib/cloud-templates';

interface TemplatesPaneProps {
  /** Becomes true when the Templates tab is shown; triggers the first load. */
  active: boolean;
  className?: string;
  userEmail?: string | null;
  /** Open a (cloned) composition in the editor — same callback the portfolio uses. */
  onOpen: (composition: CompositionData, id: string, name: string) => void;
}

/**
 * Templates view: lists every published template (cross-user, logged-in only)
 * and lets the viewer clone one into their own account ("Use this template") or
 * unpublish their own. Kept as a self-contained sibling of the compositions pane
 * so the existing portfolio logic stays untouched.
 */
export const TemplatesPane: React.FC<TemplatesPaneProps> = ({ active, className, userEmail, onOpen }) => {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [unpublishingId, setUnpublishingId] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const fetchAll = async () => {
    setLoading(true);
    setError('');
    try {
      setTemplates(await listTemplates());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load templates.');
    } finally {
      setLoading(false);
    }
  };

  // Load once when the tab is first shown; refresh button re-fetches on demand.
  useEffect(() => {
    if (active && !loadedRef.current && userEmail) {
      loadedRef.current = true;
      void fetchAll();
    }
  }, [active, userEmail]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(t => {
      const hay = [
        t.name,
        t.authorEmail ?? '',
        t.meta?.description ?? '',
        t.meta?.category ?? '',
        t.meta?.metaArea ?? '',
        ...(t.meta?.tags ?? []),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [templates, search]);

  const handleUse = async (t: TemplateSummary) => {
    setError('');
    setCloningId(t.templateId);
    try {
      const { id, name, composition } = await cloneTemplate(t.templateId);
      onOpen(composition, id, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to use template.');
    } finally {
      setCloningId(null);
    }
  };

  const handleUnpublish = async (t: TemplateSummary) => {
    if (!confirm(`Unpublish "${t.name}"? It will no longer be available to others.`)) return;
    setError('');
    setUnpublishingId(t.templateId);
    try {
      await unpublishTemplate(t.templateId);
      setTemplates(prev => prev.filter(x => x.templateId !== t.templateId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unpublish.');
    } finally {
      setUnpublishingId(null);
    }
  };

  return (
    <div className={`flex-1 overflow-y-auto p-4 space-y-3 ${className ?? ''}`}>
      <div className="flex items-center gap-2">
        <input
          type="search"
          placeholder="Search templates by name, author, tags, category…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <button
          onClick={() => void fetchAll()}
          disabled={loading || !userEmail}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition disabled:opacity-40"
          title="Refresh templates"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loading && templates.length === 0 ? (
        <div className="text-center text-slate-500 text-sm py-10">Loading templates…</div>
      ) : visible.length === 0 ? (
        <div className="text-center text-slate-500 text-sm py-10">
          {templates.length === 0
            ? 'No templates published yet. Publish a composition (Share icon) to start the library.'
            : 'No templates match your search.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map(t => {
            const isCloning = cloningId === t.templateId;
            const isUnpublishing = unpublishingId === t.templateId;
            return (
              <div key={t.templateId} className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <LayoutTemplate className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm text-slate-200 font-medium truncate" title={t.name}>{t.name}</p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {t.width}×{t.height} · {t.layerCount ?? 0} layers
                      {t.authorName || t.authorEmail ? ` · by ${t.authorName || t.authorEmail}` : ''}
                    </p>
                  </div>
                </div>

                {t.meta?.description && (
                  <p className="text-[11px] text-slate-400 line-clamp-2">{t.meta.description}</p>
                )}

                {(t.meta?.tags?.length || t.meta?.category || t.meta?.metaArea) && (
                  <div className="flex flex-wrap gap-1">
                    {t.meta?.category && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-300">{t.meta.category}</span>}
                    {t.meta?.metaArea && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-300">{t.meta.metaArea}</span>}
                    {(t.meta?.tags ?? []).slice(0, 4).map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-900/40 text-sky-300">#{tag}</span>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between gap-1 border-t border-slate-700 pt-2 mt-auto">
                  <button
                    onClick={() => void handleUse(t)}
                    disabled={isCloning}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded transition disabled:bg-slate-700"
                    title="Clone this template into your own account and open it"
                  >
                    {isCloning ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderOpen className="w-3 h-3" />}
                    Use this template
                  </button>
                  {t.isMine && (
                    <button
                      onClick={() => void handleUnpublish(t)}
                      disabled={isUnpublishing}
                      className="p-1 text-slate-500 hover:text-red-400 transition disabled:opacity-50"
                      title="Unpublish (you are the author)"
                    >
                      {isUnpublishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
