import { readStoredUser } from './auth';
import type { CompositionData } from './api';

const VEMOTION_API = 'https://api.vegvisr.org/vemotion';
const LAST_COMPOSITION_KEY = 'vemotion:last-composition';

export type CloudSaveType = 'manual' | 'autosave';

export type CloudSaveResponse = {
  id: string;
  version?: number;
  unchanged?: boolean;
};

export type StoredCompositionRef = {
  id: string;
  name: string;
};

const getToken = () => readStoredUser()?.emailVerificationToken ?? null;

export const hasCloudToken = () => Boolean(getToken());

export const readLastCompositionRef = (): StoredCompositionRef | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_COMPOSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCompositionRef>;
    if (typeof parsed.id !== 'string' || !parsed.id.trim()) return null;
    return {
      id: parsed.id.trim(),
      name: typeof parsed.name === 'string' ? parsed.name : '',
    };
  } catch {
    return null;
  }
};

export const writeLastCompositionRef = (value: StoredCompositionRef | null) => {
  if (typeof window === 'undefined') return;
  if (!value?.id) {
    window.localStorage.removeItem(LAST_COMPOSITION_KEY);
    return;
  }
  window.localStorage.setItem(LAST_COMPOSITION_KEY, JSON.stringify(value));
};

export const getCompositionFromCloud = async (id: string) => {
  const token = getToken();
  if (!token) {
    throw new Error('Sign in to use cloud save.');
  }

  const res = await fetch(`${VEMOTION_API}/composition?id=${encodeURIComponent(id)}`, {
    headers: { 'X-API-Token': token },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load composition.');
  }

  return data as {
    ok: true;
    id: string;
    name: string;
    version?: number;
    composition: CompositionData;
  };
};

export const saveCompositionToCloud = async ({
  id,
  name,
  composition,
  saveType = 'manual',
}: {
  id?: string | null;
  name: string;
  composition: CompositionData;
  saveType?: CloudSaveType;
}): Promise<CloudSaveResponse> => {
  const token = getToken();
  if (!token) {
    throw new Error('Sign in to use cloud save.');
  }

  const res = await fetch(`${VEMOTION_API}/composition/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': token },
    body: JSON.stringify({
      id: id ?? undefined,
      name,
      composition,
      saveType,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to save composition.');
  }

  writeLastCompositionRef({ id: data.id, name });

  return data;
};
