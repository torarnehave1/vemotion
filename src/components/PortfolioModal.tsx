import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Trash2, Edit2, FolderOpen, RefreshCw, Save, Image as ImageIcon, FolderPlus, Plus, ChevronDown, ChevronRight, BookOpen } from 'lucide-react';
import type { CompositionData, CompositionMeta } from '../lib/api';
import { readStoredUser } from '../lib/auth';
import { getCompositionFromCloud, saveCompositionToCloud } from '../lib/cloud-compositions';
import { renderThumbnail } from '../lib/thumbnail';
import {
  listProjects,
  getProject,
  createProject,
  addChapter,
  addCompositionToChapter,
  type ProjectSummary,
  type ProjectDetail,
} from '../lib/project-graphs';

const VEMOTION_API = 'https://api.vegvisr.org/vemotion';

interface CompositionSummary {
  id: string;
  name: string;
  duration?: number;
  fps?: number;
  width?: number;
  height?: number;
  layerCount?: number;
  createdAt?: string;
  updatedAt?: string;
  version?: number;
  meta?: CompositionMeta;
}

interface PortfolioModalProps {
  onClose: () => void;
  onOpen: (composition: CompositionData, id: string, name: string) => void;
  userEmail?: string;
}

type SortBy = 'updated' | 'created' | 'name';

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Recently created' },
  { value: 'name',    label: 'Name (A → Z)' },
];

const SENTINEL_ALL = '__all__';

/**
 * Searchable, sortable, filterable portfolio of cloud compositions.
 * Replaces the old "Open from cloud" dropdown panel inside FileMenu.
 * Mirrors GraphPortfolio.vue's spirit at a fraction of the scope: sidebar
 * with Sort + Meta Area + Category filters; main pane with search +
 * tag-chip filter + card grid with open/edit/delete actions.
 *
 * Fetch strategy: follows the `cursor` from /vemotion/compositions all the
 * way to the end so the user sees every composition (not just the first 50).
 * Tag/category/metaArea facets are derived from the meta fields of the
 * fetched summaries — free-form, no central registry.
 */
export const PortfolioModal: React.FC<PortfolioModalProps> = ({ onClose, onOpen, userEmail }) => {
  const [items, setItems] = useState<CompositionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('updated');
  const [filterCategory, setFilterCategory] = useState<string>(SENTINEL_ALL);
  const [filterMetaArea, setFilterMetaArea] = useState<string>(SENTINEL_ALL);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());

  // Per-card edit state (one open at a time keeps UI calm).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTagsInput, setEditTagsInput] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editMetaArea, setEditMetaArea] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [openingId, setOpeningId] = useState<string | null>(null);

  // ── Projects (book/chapter outline, backed by KG) ───────────────────────────
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsError, setProjectsError] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null); // graphId
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  // Inline "new project" / "new chapter" forms.
  const [newProjectName, setNewProjectName] = useState<string | null>(null); // null = form closed
  const [newChapterName, setNewChapterName] = useState<string | null>(null);
  // Per-card "add to chapter" in flight (composition id).
  const [addingToChapterId, setAddingToChapterId] = useState<string | null>(null);

  // Thumbnail cache. Keyed by composition id. Sentinel strings indicate
  // not-ready / loading / failed; otherwise the value is a PNG data URL.
  // Persists for the lifetime of the modal — closing + reopening rerenders.
  const [thumbnails, setThumbnails] = useState<Map<string, ThumbState>>(new Map());

  const getToken = useCallback(() => readStoredUser()?.emailVerificationToken ?? null, []);

  // ── Fetch all compositions, following cursor ────────────────────────────────
  const fetchAll = useCallback(async () => {
    const token = getToken();
    if (!token) { setError('Sign in to use cloud compositions.'); return; }
    setLoading(true);
    setError('');
    try {
      const all: CompositionSummary[] = [];
      let cursor: string | null = null;
      // Cap pages to avoid runaway loops on a buggy server.
      for (let page = 0; page < 50; page++) {
        const url = new URL(`${VEMOTION_API}/compositions`);
        url.searchParams.set('limit', '200');
        if (cursor) url.searchParams.set('cursor', cursor);
        const res = await fetch(url.toString(), { headers: { 'X-API-Token': token } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'List failed');
        all.push(...(data.compositions ?? []));
        cursor = data.cursor ?? null;
        if (!cursor) break;
      }
      setItems(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load compositions');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ── Projects: load list, then detail on selection ───────────────────────────
  const loadProjects = useCallback(async () => {
    try {
      setProjectsError('');
      setProjects(await listProjects());
    } catch (e) {
      setProjectsError(e instanceof Error ? e.message : 'Failed to load projects');
    }
  }, []);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  const refreshProjectDetail = useCallback(async (graphId: string) => {
    setProjectBusy(true);
    try {
      setProjectDetail(await getProject(graphId));
    } catch (e) {
      setProjectsError(e instanceof Error ? e.message : 'Failed to load project');
    } finally {
      setProjectBusy(false);
    }
  }, []);

  // Selecting a project loads its outline and pins the metaArea filter to it
  // (membership = composition.meta.metaArea === project.metaArea).
  const selectProject = useCallback((p: ProjectSummary | null) => {
    setSelectedChapterId(null);
    if (!p) {
      setSelectedProjectId(null);
      setProjectDetail(null);
      setFilterMetaArea(SENTINEL_ALL);
      return;
    }
    setSelectedProjectId(p.graphId);
    setFilterMetaArea(p.metaArea || SENTINEL_ALL);
    void refreshProjectDetail(p.graphId);
  }, [refreshProjectDetail]);

  // Composition ids placed in the currently-selected chapter (for grid narrowing).
  const selectedChapterCompIds = useMemo(() => {
    if (!selectedChapterId || !projectDetail) return null;
    const ch = projectDetail.chapters.find(c => c.id === selectedChapterId);
    if (!ch) return null;
    return new Set(ch.compositions.map(c => c.compositionId));
  }, [selectedChapterId, projectDetail]);

  const handleCreateProject = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setProjectBusy(true);
    try {
      const created = await createProject({ metaArea: trimmed });
      setNewProjectName(null);
      await loadProjects();
      selectProject(created);
    } catch (e) {
      setProjectsError(e instanceof Error ? e.message : 'Failed to create project');
    } finally {
      setProjectBusy(false);
    }
  }, [loadProjects, selectProject]);

  const handleAddChapter = useCallback(async (name: string) => {
    if (!selectedProjectId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setProjectBusy(true);
    try {
      await addChapter(selectedProjectId, trimmed);
      setNewChapterName(null);
      await refreshProjectDetail(selectedProjectId);
    } catch (e) {
      setProjectsError(e instanceof Error ? e.message : 'Failed to add chapter');
    } finally {
      setProjectBusy(false);
    }
  }, [selectedProjectId, refreshProjectDetail]);

  // Add a composition to a chapter: (1) set its meta.metaArea to the project's
  // (reuse-metaArea membership — spread-and-override to preserve other meta),
  // (2) append the compref node + edge to the project graph.
  const handleAddToChapter = useCallback(async (item: CompositionSummary, chapterId: string) => {
    if (!selectedProjectId || !projectDetail) return;
    setAddingToChapterId(item.id);
    try {
      const projectMetaArea = projectDetail.metaArea;
      const full = await getCompositionFromCloud(item.id);
      const nextMeta: CompositionMeta = { ...(full.composition.meta ?? {}), metaArea: projectMetaArea };
      await saveCompositionToCloud({
        id: item.id,
        name: full.name,
        composition: { ...full.composition, meta: nextMeta },
        saveType: 'manual',
      });
      await addCompositionToChapter(selectedProjectId, chapterId, { compositionId: item.id, name: full.name || item.name });
      // Reflect new membership locally + refresh the outline.
      setItems(prev => prev.map(it => it.id === item.id ? { ...it, meta: nextMeta } : it));
      await refreshProjectDetail(selectedProjectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add to chapter');
    } finally {
      setAddingToChapterId(null);
    }
  }, [selectedProjectId, projectDetail, refreshProjectDetail]);

  // ── Facets (derive from currently-fetched items) ────────────────────────────
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) { if (it.meta?.category) set.add(it.meta.category); }
    return [...set].sort();
  }, [items]);

  const allMetaAreas = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) { if (it.meta?.metaArea) set.add(it.meta.metaArea); }
    return [...set].sort();
  }, [items]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) { (it.meta?.tags ?? []).forEach(t => set.add(t)); }
    return [...set].sort();
  }, [items]);

  // ── Filter + sort pipeline ──────────────────────────────────────────────────
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = items.filter(it => {
      if (selectedChapterCompIds && !selectedChapterCompIds.has(it.id)) return false;
      if (filterCategory !== SENTINEL_ALL && (it.meta?.category ?? '') !== filterCategory) return false;
      if (filterMetaArea !== SENTINEL_ALL && (it.meta?.metaArea ?? '') !== filterMetaArea) return false;
      if (activeTags.size > 0) {
        const tags = new Set(it.meta?.tags ?? []);
        for (const t of activeTags) { if (!tags.has(t)) return false; }
      }
      if (q) {
        const haystack = [
          it.name ?? '',
          it.meta?.description ?? '',
          it.meta?.category ?? '',
          it.meta?.metaArea ?? '',
          ...(it.meta?.tags ?? []),
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) => {
      if (sortBy === 'name') return (a.name ?? '').localeCompare(b.name ?? '');
      const aKey = sortBy === 'created' ? a.createdAt : a.updatedAt;
      const bKey = sortBy === 'created' ? b.createdAt : b.updatedAt;
      const aT = aKey ? new Date(aKey).getTime() : 0;
      const bT = bKey ? new Date(bKey).getTime() : 0;
      return bT - aT;
    });
    return out;
  }, [items, search, sortBy, filterCategory, filterMetaArea, activeTags, selectedChapterCompIds]);

  const toggleTag = (tag: string) => {
    setActiveTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  // ── Thumbnail lazy-loader ───────────────────────────────────────────────────
  // Triggered per card via IntersectionObserver (see CardThumbnail below).
  // Fetches the full composition (the list endpoint only returns summaries —
  // no layers), renders frame 0 to an offscreen canvas, downscales to a
  // ~320px-wide PNG data URL, caches by id. Failed renders cache an 'error'
  // sentinel so we don't retry forever.
  const requestThumbnail = useCallback(async (id: string) => {
    // Functional update so concurrent requests don't race.
    let alreadyRequested = false;
    setThumbnails(prev => {
      if (prev.has(id)) { alreadyRequested = true; return prev; }
      return new Map(prev).set(id, { kind: 'loading' });
    });
    if (alreadyRequested) return;
    try {
      const full = await getCompositionFromCloud(id);
      const dataUrl = await renderThumbnail(full.composition, 320);
      setThumbnails(prev => new Map(prev).set(id, { kind: 'ready', dataUrl }));
    } catch {
      setThumbnails(prev => new Map(prev).set(id, { kind: 'error' }));
    }
  }, []);

  // ── Per-card actions ────────────────────────────────────────────────────────
  const handleOpen = async (id: string, name: string) => {
    setOpeningId(id);
    try {
      const data = await getCompositionFromCloud(id);
      onOpen(data.composition, data.id, data.name || name);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open composition');
    } finally {
      setOpeningId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this composition? This cannot be undone.')) return;
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch(`${VEMOTION_API}/composition?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-API-Token': token },
      });
      if (!res.ok) throw new Error('Delete failed');
      setItems(prev => prev.filter(it => it.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const beginEdit = (item: CompositionSummary) => {
    setEditingId(item.id);
    setEditTagsInput((item.meta?.tags ?? []).join(', '));
    setEditCategory(item.meta?.category ?? '');
    setEditMetaArea(item.meta?.metaArea ?? '');
    setEditDescription(item.meta?.description ?? '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTagsInput('');
    setEditCategory('');
    setEditMetaArea('');
    setEditDescription('');
  };

  const saveEdit = async (item: CompositionSummary) => {
    setSavingEdit(true);
    try {
      // Fetch full composition (need the body to save back; the summary
      // doesn't include layers).
      const full = await getCompositionFromCloud(item.id);
      const tags = editTagsInput
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);
      const nextMeta: CompositionMeta = {
        ...(full.composition.meta ?? {}),
        description: editDescription.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        category: editCategory.trim() || undefined,
        metaArea: editMetaArea.trim() || undefined,
      };
      // Strip undefined-only fields so we don't write empty meta blocks.
      const cleaned: CompositionMeta = {};
      if (nextMeta.description) cleaned.description = nextMeta.description;
      if (nextMeta.tags?.length)  cleaned.tags        = nextMeta.tags;
      if (nextMeta.category)      cleaned.category    = nextMeta.category;
      if (nextMeta.metaArea)      cleaned.metaArea    = nextMeta.metaArea;
      const updatedComp: CompositionData = {
        ...full.composition,
        meta: Object.keys(cleaned).length > 0 ? cleaned : undefined,
      };
      await saveCompositionToCloud({
        id: item.id,
        name: full.name,
        composition: updatedComp,
        saveType: 'manual',
      });
      // Optimistically update local list state with the new meta.
      setItems(prev => prev.map(it => it.id === item.id
        ? { ...it, meta: Object.keys(cleaned).length > 0 ? cleaned : undefined }
        : it));
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingEdit(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-semibold text-slate-200">Compositions Portfolio</h2>
            <span className="text-xs text-slate-500">{visible.length} of {items.length}</span>
            {!userEmail && <span className="text-xs text-red-400">Sign in to load compositions</span>}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void fetchAll()}
              disabled={loading || !userEmail}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition disabled:opacity-40"
              title="Refresh"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body: sidebar + main */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <aside className="w-60 flex-shrink-0 border-r border-slate-800 overflow-y-auto p-4 space-y-5 bg-slate-900/40">
            <Section title="Sort by">
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as SortBy)}
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Section>

            <Section title="Project">
              {projectsError && <p className="text-[11px] text-red-400 mb-1">{projectsError}</p>}
              <div className="space-y-0.5">
                <button
                  onClick={() => selectProject(null)}
                  className={[
                    'w-full text-left px-2 py-1 text-xs rounded transition border-l-2',
                    selectedProjectId === null
                      ? 'bg-sky-600/20 text-sky-300 border-sky-500'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 border-transparent',
                  ].join(' ')}
                >
                  All compositions
                </button>

                {projects.map(p => {
                  const active = selectedProjectId === p.graphId;
                  return (
                    <div key={p.graphId}>
                      <button
                        onClick={() => (active ? selectProject(null) : selectProject(p))}
                        className={[
                          'w-full flex items-center gap-1 px-2 py-1 text-xs rounded transition border-l-2',
                          active
                            ? 'bg-sky-600/20 text-sky-300 border-sky-500'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 border-transparent',
                        ].join(' ')}
                        title={p.title}
                      >
                        {active ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
                        <BookOpen className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{p.title}</span>
                      </button>

                      {active && (
                        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-700 pl-2">
                          {projectBusy && !projectDetail && (
                            <p className="text-[11px] text-slate-500 px-1">Loading…</p>
                          )}
                          {(projectDetail?.chapters ?? []).map(ch => (
                            <button
                              key={ch.id}
                              onClick={() => setSelectedChapterId(selectedChapterId === ch.id ? null : ch.id)}
                              className={[
                                'w-full text-left px-2 py-0.5 text-xs rounded transition border-l-2',
                                selectedChapterId === ch.id
                                  ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500'
                                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 border-transparent',
                              ].join(' ')}
                            >
                              <span className="truncate">{ch.title}</span>
                              <span className="text-slate-600"> ({ch.compositions.length})</span>
                            </button>
                          ))}
                          {projectDetail && projectDetail.chapters.length === 0 && newChapterName === null && (
                            <p className="text-[11px] text-slate-500 px-1">No chapters yet.</p>
                          )}
                          {newChapterName === null ? (
                            <button
                              onClick={() => setNewChapterName('')}
                              className="w-full flex items-center gap-1 px-2 py-0.5 text-[11px] text-slate-500 hover:text-sky-300 transition"
                            >
                              <Plus className="w-3 h-3" /> Chapter
                            </button>
                          ) : (
                            <form
                              onSubmit={(e) => { e.preventDefault(); void handleAddChapter(newChapterName); }}
                              className="flex gap-1 pt-0.5"
                            >
                              <input
                                autoFocus
                                value={newChapterName}
                                onChange={(e) => setNewChapterName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Escape') setNewChapterName(null); }}
                                placeholder="Chapter title"
                                className="flex-1 min-w-0 bg-slate-900 border border-slate-700 text-slate-200 text-[11px] rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500"
                              />
                              <button
                                type="submit"
                                disabled={projectBusy}
                                className="px-1.5 py-1 text-[11px] bg-sky-600 hover:bg-sky-500 text-white rounded disabled:bg-slate-700"
                              >
                                {projectBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add'}
                              </button>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {newProjectName === null ? (
                  <button
                    onClick={() => setNewProjectName('')}
                    className="w-full flex items-center gap-1 px-2 py-1 text-[11px] text-slate-500 hover:text-sky-300 transition"
                  >
                    <FolderPlus className="w-3 h-3" /> New project
                  </button>
                ) : (
                  <form
                    onSubmit={(e) => { e.preventDefault(); void handleCreateProject(newProjectName); }}
                    className="flex gap-1 pt-1"
                  >
                    <input
                      autoFocus
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') setNewProjectName(null); }}
                      placeholder="Project meta area"
                      className="flex-1 min-w-0 bg-slate-900 border border-slate-700 text-slate-200 text-[11px] rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                    <button
                      type="submit"
                      disabled={projectBusy}
                      className="px-1.5 py-1 text-[11px] bg-sky-600 hover:bg-sky-500 text-white rounded disabled:bg-slate-700"
                    >
                      {projectBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Create'}
                    </button>
                  </form>
                )}
              </div>
            </Section>

            <Section title="Meta area">
              <RadioList
                value={filterMetaArea}
                options={[{ v: SENTINEL_ALL, label: `All (${items.length})` }, ...allMetaAreas.map(a => ({
                  v: a,
                  label: `${a} (${items.filter(it => it.meta?.metaArea === a).length})`,
                }))]}
                onChange={setFilterMetaArea}
              />
            </Section>

            <Section title="Category">
              <RadioList
                value={filterCategory}
                options={[{ v: SENTINEL_ALL, label: `All (${items.length})` }, ...allCategories.map(c => ({
                  v: c,
                  label: `${c} (${items.filter(it => it.meta?.category === c).length})`,
                }))]}
                onChange={setFilterCategory}
              />
            </Section>
          </aside>

          {/* Main */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <input
              type="search"
              placeholder="Search name, description, tags, category, area…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />

            {/* Tag chips */}
            {allTags.length > 0 && (
              <div className="flex items-start gap-2 flex-wrap">
                <span className="text-xs text-slate-500 pt-0.5">Tags:</span>
                {allTags.map(tag => {
                  const active = activeTags.has(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={[
                        'text-xs px-2 py-0.5 rounded-full border transition',
                        active
                          ? 'bg-sky-600 text-white border-sky-500'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600',
                      ].join(' ')}
                    >
                      #{tag}
                    </button>
                  );
                })}
              </div>
            )}

            {error && (
              <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {loading && items.length === 0 ? (
              <div className="text-center text-slate-500 text-sm py-10">Loading…</div>
            ) : visible.length === 0 ? (
              <div className="text-center text-slate-500 text-sm py-10">
                {items.length === 0 ? 'No compositions yet.' : 'No matches for current filters.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {visible.map(item => {
                  const isEditing = editingId === item.id;
                  const isOpening = openingId === item.id;
                  const aspectRatio = (item.width && item.height && item.height > 0)
                    ? item.width / item.height
                    : 16 / 9;
                  return (
                    <div
                      key={item.id}
                      className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 flex flex-col gap-2"
                    >
                      <CardThumbnail
                        compositionId={item.id}
                        state={thumbnails.get(item.id) ?? { kind: 'pending' }}
                        aspectRatio={aspectRatio}
                        onRequest={requestThumbnail}
                      />
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-medium text-slate-100 truncate" title={item.name}>
                          {item.name || '(untitled)'}
                        </h3>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className="text-[10px] text-slate-500 font-mono">v{item.version ?? 1}</span>
                        </div>
                      </div>

                      <div className="flex gap-1.5 flex-wrap text-[10px]">
                        {item.meta?.category && (
                          <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30">
                            {item.meta.category}
                          </span>
                        )}
                        {item.meta?.metaArea && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            {item.meta.metaArea}
                          </span>
                        )}
                        {(item.meta?.tags ?? []).map(t => (
                          <span key={t} className="px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300 border border-slate-600">
                            #{t}
                          </span>
                        ))}
                      </div>

                      {item.meta?.description && (
                        <p className="text-xs text-slate-400 line-clamp-3" title={item.meta.description}>
                          {item.meta.description}
                        </p>
                      )}

                      <div className="text-[10px] text-slate-500 mt-auto">
                        {item.width}×{item.height} · {item.fps} fps · {item.duration}s · {item.layerCount} layer{item.layerCount === 1 ? '' : 's'}
                        {item.updatedAt && ` · ${new Date(item.updatedAt).toLocaleDateString()}`}
                      </div>

                      {/* Edit form */}
                      {isEditing && (
                        <div className="border-t border-slate-700 pt-2 space-y-2">
                          <textarea
                            placeholder="Description (one paragraph)"
                            value={editDescription}
                            onChange={e => setEditDescription(e.target.value)}
                            rows={3}
                            className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 resize-y focus:outline-none focus:ring-1 focus:ring-sky-500"
                          />
                          <input
                            placeholder="Tags (comma separated, e.g. animation, title-card)"
                            value={editTagsInput}
                            onChange={e => setEditTagsInput(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              placeholder="Category"
                              value={editCategory}
                              onChange={e => setEditCategory(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500"
                            />
                            <input
                              placeholder="Meta area"
                              value={editMetaArea}
                              onChange={e => setEditMetaArea(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500"
                            />
                          </div>
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={cancelEdit}
                              disabled={savingEdit}
                              className="px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 rounded transition"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => void saveEdit(item)}
                              disabled={savingEdit}
                              className="px-2 py-1 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded transition flex items-center gap-1 disabled:bg-slate-700"
                            >
                              {savingEdit ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              Save
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Action row */}
                      {!isEditing && (
                        <div className="flex items-center justify-between gap-1 border-t border-slate-700 pt-2">
                          <button
                            onClick={() => void handleOpen(item.id, item.name)}
                            disabled={isOpening}
                            className="flex items-center gap-1 px-2 py-1 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded transition disabled:bg-slate-700"
                          >
                            {isOpening ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderOpen className="w-3 h-3" />}
                            Open
                          </button>
                          <div className="flex items-center gap-1">
                            {selectedProjectId && projectDetail && projectDetail.chapters.length > 0 && (
                              <select
                                value=""
                                disabled={addingToChapterId === item.id}
                                onChange={(e) => {
                                  const ch = e.target.value;
                                  e.target.value = '';
                                  if (ch) void handleAddToChapter(item, ch);
                                }}
                                className="bg-slate-900 border border-slate-700 text-slate-300 text-[10px] rounded px-1 py-0.5 max-w-[7.5rem] focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
                                title="Add this composition to a chapter of the selected project"
                              >
                                <option value="">{addingToChapterId === item.id ? 'Adding…' : '+ Chapter'}</option>
                                {projectDetail.chapters.map(ch => (
                                  <option key={ch.id} value={ch.id}>{ch.title}</option>
                                ))}
                              </select>
                            )}
                            <button
                              onClick={() => beginEdit(item)}
                              className="p-1 text-slate-500 hover:text-emerald-400 transition"
                              title="Edit metadata (tags, category, area, description)"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => void handleDelete(item.id)}
                              className="p-1 text-slate-500 hover:text-red-400 transition"
                              title="Delete composition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ── Small inline helpers (kept local so the file is one self-contained slice) ─

type ThumbState =
  | { kind: 'pending' }     // not yet requested (default for cards never scrolled into view)
  | { kind: 'loading' }     // request in flight
  | { kind: 'error' }       // request failed; do not retry
  | { kind: 'ready'; dataUrl: string };

/**
 * Per-card lazy thumbnail. Uses IntersectionObserver — only fires the
 * render request when the card scrolls within ~200 px of the viewport,
 * so portfolio open is cheap regardless of catalogue size.
 *
 * Reserves the aspect-ratio box before the thumbnail loads so cards don't
 * jump as previews populate.
 */
const CardThumbnail: React.FC<{
  compositionId: string;
  state: ThumbState;
  aspectRatio: number;
  onRequest: (id: string) => void;
}> = ({ compositionId, state, aspectRatio, onRequest }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.kind !== 'pending' || !ref.current) return;
    const el = ref.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onRequest(compositionId);
            observer.disconnect();
          }
        }
      },
      { rootMargin: '200px' }, // start fetching slightly before fully visible
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [compositionId, state.kind, onRequest]);

  return (
    <div
      ref={ref}
      className="w-full bg-slate-950/80 border border-slate-700/50 rounded overflow-hidden flex items-center justify-center"
      style={{ aspectRatio: `${aspectRatio}` }}
    >
      {state.kind === 'ready' ? (
        <img src={state.dataUrl} alt="" className="w-full h-full object-contain" />
      ) : state.kind === 'error' ? (
        <ImageIcon className="w-6 h-6 text-slate-600" />
      ) : state.kind === 'loading' ? (
        <Loader2 className="w-5 h-5 text-slate-600 animate-spin" />
      ) : (
        <ImageIcon className="w-6 h-6 text-slate-700/50" />
      )}
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h4 className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">{title}</h4>
    {children}
  </div>
);

interface RadioOption { v: string; label: string }
const RadioList: React.FC<{ value: string; options: RadioOption[]; onChange: (v: string) => void }> = ({ value, options, onChange }) => (
  <div className="space-y-0.5">
    {options.map(opt => (
      <button
        key={opt.v}
        onClick={() => onChange(opt.v)}
        className={[
          'w-full text-left px-2 py-1 text-xs rounded transition',
          value === opt.v
            ? 'bg-sky-600/20 text-sky-300 border-l-2 border-sky-500'
            : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 border-l-2 border-transparent',
        ].join(' ')}
      >
        {opt.label}
      </button>
    ))}
  </div>
);
