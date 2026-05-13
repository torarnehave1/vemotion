import { readStoredUser } from './auth';
import type { CompositionData } from './api';

const VEMOTION_API = 'https://api.vegvisr.org/vemotion';

export type CloudSaveType = 'manual' | 'autosave';

export type CloudSaveResponse = {
  id: string;
  version?: number;
  unchanged?: boolean;
};

const getToken = () => readStoredUser()?.emailVerificationToken ?? null;

export const hasCloudToken = () => Boolean(getToken());

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

  return data;
};
