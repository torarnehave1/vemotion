import { readStoredUser } from './auth';
import type { CompositionData, CompositionMeta } from './api';
import { saveCompositionToCloud } from './cloud-compositions';

const VEMOTION_API = 'https://api.vegvisr.org/vemotion';

const getToken = () => readStoredUser()?.emailVerificationToken ?? null;

/**
 * A published template is a FROZEN snapshot of a composition, readable by any
 * authenticated user. Publishing copies the composition into the template store;
 * later edits to the source composition do NOT change the template until it is
 * re-published. See vemotion-worker `/vemotion/template*` endpoints.
 */
export type TemplateSummary = {
  templateId: string;
  sourceCompId: string;
  name: string;
  authorEmail?: string | null;
  authorName?: string | null;
  duration?: number;
  fps?: number;
  width?: number;
  height?: number;
  layerCount?: number;
  createdAt?: string;
  updatedAt?: string;
  /** True when the authenticated caller is the template author. */
  isMine?: boolean;
  meta?: CompositionMeta;
};

export type TemplateRecord = {
  ok: true;
  templateId: string;
  sourceCompId: string;
  name: string;
  composition: CompositionData;
  isMine?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

/** List every published template (cross-user). Paginates to completion. */
export const listTemplates = async (): Promise<TemplateSummary[]> => {
  const token = getToken();
  if (!token) throw new Error('Sign in to view templates.');

  const all: TemplateSummary[] = [];
  let cursor: string | null = null;
  do {
    const url = new URL(`${VEMOTION_API}/templates`);
    url.searchParams.set('limit', '200');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url.toString(), { headers: { 'X-API-Token': token } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load templates.');
    if (Array.isArray(data.templates)) all.push(...(data.templates as TemplateSummary[]));
    cursor = typeof data.cursor === 'string' ? data.cursor : null;
  } while (cursor);

  return all;
};

/** Fetch one template's full frozen composition. */
export const getTemplateFromCloud = async (templateId: string): Promise<TemplateRecord> => {
  const token = getToken();
  if (!token) throw new Error('Sign in to open templates.');
  const res = await fetch(`${VEMOTION_API}/template?id=${encodeURIComponent(templateId)}`, {
    headers: { 'X-API-Token': token },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load template.');
  return data as TemplateRecord;
};

/** Publish (or re-publish) a composition the caller owns as a template. */
export const publishTemplate = async (
  compositionId: string,
  name?: string,
): Promise<{ ok: true; templateId: string; republished: boolean; summary: TemplateSummary }> => {
  const token = getToken();
  if (!token) throw new Error('Sign in to publish a template.');
  const res = await fetch(`${VEMOTION_API}/template/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': token },
    body: JSON.stringify({ compositionId, name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to publish template.');
  return data;
};

/** Unpublish a template (author only). */
export const unpublishTemplate = async (templateId: string): Promise<void> => {
  const token = getToken();
  if (!token) throw new Error('Sign in to unpublish a template.');
  const res = await fetch(`${VEMOTION_API}/template?id=${encodeURIComponent(templateId)}`, {
    method: 'DELETE',
    headers: { 'X-API-Token': token },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to unpublish template.');
};

/**
 * Clone a template into the caller's own account: fetch the frozen snapshot,
 * then save it as a NEW composition (no id → the worker mints one). Returns the
 * new composition id + name so the caller can open it in the editor.
 */
export const cloneTemplate = async (
  templateId: string,
): Promise<{ id: string; name: string; composition: CompositionData }> => {
  const record = await getTemplateFromCloud(templateId);
  const name = `${record.name} (copy)`;
  // Deep copy so the editor never shares a reference with the fetched record.
  const composition = JSON.parse(JSON.stringify(record.composition)) as CompositionData;
  const saved = await saveCompositionToCloud({ name, composition, saveType: 'manual' });
  return { id: saved.id, name, composition };
};
