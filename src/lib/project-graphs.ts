import { readStoredUser } from './auth';

/**
 * Vemotion "projects" — book/course/project outlines stored as Knowledge Graphs.
 *
 * Model (decided with the user; see _project plan):
 *   - ONE KG graph per project. Graph id is a UUID v4 (the KG API enforces a
 *     UUID pattern for NEW graphs — a semantic id is rejected at creation).
 *   - The graph is identified as a Vemotion project by `metadata.createdBy ===
 *     PROJECT_MARKER`. Its `metadata.metaArea` is the join key.
 *   - A composition belongs to a project iff its `meta.metaArea` equals the
 *     project graph's `metadata.metaArea`. No new field on the composition —
 *     membership reuses the existing metaArea (the user's vocabulary).
 *   - Chapters are `fulltext` nodes; composition references are `link` nodes
 *     (viewer URL in `path`, composition id in `info`). A small JSON envelope
 *     in each node's `info` carries a `kind` discriminator + `order`, because
 *     the KG node `type` enum has no custom Vemotion type.
 *   - Edges express structure via their `label` (the only field available):
 *     `has-chapter` (project-root → chapter), `contains` (chapter → compref).
 *
 * Writes go through `saveGraphWithHistory` with `override: true` (full-graph
 * overwrite — read, mutate in memory, POST the whole graph back). Reads use
 * the public `getknowgraph` / `getknowgraphsummaries` endpoints.
 */

const KG_BASE = 'https://knowledge.vegvisr.org';

/** metadata.createdBy marker that identifies a graph as a Vemotion project. */
const PROJECT_MARKER = 'vemotion-project';

const KIND_PROJECT = 'vemotion-project';
const KIND_CHAPTER = 'vemotion-chapter';
const KIND_COMPREF = 'vemotion-compref';
const EDGE_HAS_CHAPTER = 'has-chapter';
const EDGE_CONTAINS = 'contains';

const COMPOSITION_VIEWER = 'https://vemotion.vegvisr.org/?compositionId=';

const COLOR_PROJECT = '#1e293b';
const COLOR_CHAPTER = '#6366f1';
const COLOR_COMPREF = '#0ea5e9';

const getToken = () => readStoredUser()?.emailVerificationToken ?? null;

// ── Raw KG shapes (only the fields we touch) ────────────────────────────────
type KgNode = {
  id: string;
  label: string;
  type?: string;
  color?: string;
  info?: string;
  path?: string;
  visible?: boolean;
  [k: string]: unknown;
};
type KgEdge = { id?: string; source: string; target: string; label?: string };
type KgMetadata = { title: string; metaArea?: string; createdBy?: string; description?: string; [k: string]: unknown };
type KgGraph = { metadata?: KgMetadata; nodes: KgNode[]; edges: KgEdge[] };

// ── Parsed project shapes (what the UI consumes) ────────────────────────────
export type ProjectSummary = { graphId: string; metaArea: string; title: string };
export type ProjectComposition = { compositionId: string; name: string; viewerUrl: string; order: number };
export type ProjectChapter = { id: string; title: string; order: number; compositions: ProjectComposition[] };
export type ProjectDetail = { graphId: string; metaArea: string; title: string; chapters: ProjectChapter[] };

type NodeInfo = { kind?: string; order?: number; compositionId?: string };

const parseInfo = (info?: string): NodeInfo => {
  if (!info) return {};
  try {
    const v = JSON.parse(info);
    return v && typeof v === 'object' ? (v as NodeInfo) : {};
  } catch {
    return {};
  }
};

const newUuid = (): string => {
  // Browser secure-context API; available in all supported targets.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback (non-secure contexts): RFC-4122-ish v4.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const fetchGraph = async (graphId: string): Promise<KgGraph> => {
  const res = await fetch(`${KG_BASE}/getknowgraph?id=${encodeURIComponent(graphId)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load project graph.');
  return {
    metadata: data.metadata,
    nodes: Array.isArray(data.nodes) ? data.nodes : [],
    edges: Array.isArray(data.edges) ? data.edges : [],
  };
};

const saveGraph = async (graphId: string, graph: KgGraph): Promise<void> => {
  const token = getToken();
  if (!token) throw new Error('Sign in to edit projects.');
  const res = await fetch(`${KG_BASE}/saveGraphWithHistory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': token },
    body: JSON.stringify({
      id: graphId,
      graphData: { metadata: graph.metadata, nodes: graph.nodes, edges: graph.edges },
      override: true,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save project graph.');
};

/**
 * List all Vemotion project graphs (those marked `createdBy === PROJECT_MARKER`).
 * Reads /getknowgraphsummaries (which includes metadata) and filters client-side.
 */
export const listProjects = async (): Promise<ProjectSummary[]> => {
  const res = await fetch(`${KG_BASE}/getknowgraphsummaries?limit=1000`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to list projects.');
  const results: Array<{ id?: string; metadata?: KgMetadata }> = Array.isArray(data.results) ? data.results : [];
  return results
    .filter((g) => g?.metadata?.createdBy === PROJECT_MARKER && typeof g.id === 'string')
    .map((g) => ({
      graphId: g.id as string,
      metaArea: g.metadata?.metaArea ?? g.metadata?.title ?? '',
      title: g.metadata?.title ?? g.metadata?.metaArea ?? '(untitled project)',
    }));
};

/** Load one project graph and parse it into chapters → composition refs. */
export const getProject = async (graphId: string): Promise<ProjectDetail> => {
  const g = await fetchGraph(graphId);
  const comprefById = new Map<string, KgNode>();
  for (const n of g.nodes) {
    if (parseInfo(n.info).kind === KIND_COMPREF) comprefById.set(n.id, n);
  }
  const chapters: ProjectChapter[] = [];
  for (const n of g.nodes) {
    const info = parseInfo(n.info);
    if (info.kind !== KIND_CHAPTER) continue;
    const compositions: ProjectComposition[] = [];
    for (const e of g.edges) {
      // The KG backend drops edge labels on save, so we identify "contains"
      // edges structurally: a chapter's outgoing edge whose target is a
      // compref node. (project-root → chapter edges target chapter nodes,
      // never comprefs, so there is no ambiguity.)
      if (e.source !== n.id) continue;
      const cn = comprefById.get(e.target);
      if (!cn) continue;
      const ci = parseInfo(cn.info);
      compositions.push({
        compositionId: ci.compositionId ?? cn.id.replace(/^compref-/, ''),
        name: cn.label,
        viewerUrl: cn.path ?? `${COMPOSITION_VIEWER}${ci.compositionId ?? ''}`,
        order: ci.order ?? 0,
      });
    }
    compositions.sort((a, b) => a.order - b.order);
    chapters.push({ id: n.id, title: n.label, order: info.order ?? 0, compositions });
  }
  chapters.sort((a, b) => a.order - b.order);
  return {
    graphId,
    metaArea: g.metadata?.metaArea ?? g.metadata?.title ?? '',
    title: g.metadata?.title ?? g.metadata?.metaArea ?? '(untitled project)',
    chapters,
  };
};

/** Create a new project graph (UUID id, marked as a Vemotion project). */
export const createProject = async ({ metaArea, title }: { metaArea: string; title?: string }): Promise<ProjectSummary> => {
  const token = getToken();
  if (!token) throw new Error('Sign in to create projects.');
  const area = metaArea.trim();
  if (!area) throw new Error('A project needs a meta area name.');
  const projectTitle = title?.trim() || area;
  const graphId = newUuid();
  const graph: KgGraph = {
    metadata: {
      title: projectTitle,
      metaArea: area,
      createdBy: PROJECT_MARKER,
      description: 'Vemotion project. Chapters and composition references.',
    },
    nodes: [
      {
        id: 'project-root',
        label: projectTitle,
        type: 'fulltext',
        color: COLOR_PROJECT,
        info: JSON.stringify({ kind: KIND_PROJECT }),
        visible: true,
      },
    ],
    edges: [],
  };
  await saveGraph(graphId, graph);
  return { graphId, metaArea: area, title: projectTitle };
};

/** Append a chapter node (+ project-root → chapter edge) to a project graph. */
export const addChapter = async (graphId: string, title: string): Promise<void> => {
  const g = await fetchGraph(graphId);
  const order = g.nodes.filter((n) => parseInfo(n.info).kind === KIND_CHAPTER).length;
  const id = `chapter-${newUuid()}`;
  g.nodes.push({
    id,
    label: title.trim() || `Chapter ${order + 1}`,
    type: 'fulltext',
    color: COLOR_CHAPTER,
    info: JSON.stringify({ kind: KIND_CHAPTER, order }),
    visible: true,
  });
  g.edges.push({ id: `edge-${newUuid()}`, source: 'project-root', target: id, label: EDGE_HAS_CHAPTER });
  if (!g.metadata) g.metadata = { title: '(untitled project)' };
  await saveGraph(graphId, g);
};

/**
 * Add a composition reference to a chapter (idempotent on the compref node and
 * the containing edge). Does NOT touch the composition itself — the caller is
 * responsible for setting the composition's meta.metaArea to the project's.
 */
export const addCompositionToChapter = async (
  graphId: string,
  chapterId: string,
  comp: { compositionId: string; name: string },
): Promise<void> => {
  const g = await fetchGraph(graphId);
  const compNodeId = `compref-${comp.compositionId}`;
  // A chapter's outgoing edges all point at comprefs, so the count of edges
  // from this chapter is the next order index. (Edge labels are dropped by the
  // backend, so we don't filter on them.)
  const order = g.edges.filter((e) => e.source === chapterId).length;

  const existing = g.nodes.find((n) => n.id === compNodeId);
  if (existing) {
    existing.label = comp.name || existing.label;
  } else {
    g.nodes.push({
      id: compNodeId,
      label: comp.name || comp.compositionId,
      type: 'link',
      color: COLOR_COMPREF,
      path: `${COMPOSITION_VIEWER}${comp.compositionId}`,
      info: JSON.stringify({ kind: KIND_COMPREF, compositionId: comp.compositionId, order }),
      visible: true,
    });
  }
  const edgeExists = g.edges.some((e) => e.source === chapterId && e.target === compNodeId);
  if (!edgeExists) {
    g.edges.push({ id: `edge-${newUuid()}`, source: chapterId, target: compNodeId, label: EDGE_CONTAINS });
  }
  if (!g.metadata) g.metadata = { title: '(untitled project)' };
  await saveGraph(graphId, g);
};

/** Viewer URL for a project graph (KG viewer). */
export const projectViewerUrl = (graphId: string): string =>
  `https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`;
