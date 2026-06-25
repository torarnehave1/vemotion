import React, { useEffect, useState } from 'react';
import type { CompositionData } from '../lib/api';
import {
  getCompositionFromCloud,
  readCompositionIdFromUrl,
} from '../lib/cloud-compositions';
import { VideoPreview } from './VideoPreview';

/**
 * Minimal embed view — for `<iframe>` consumers like agent.vegvisr.org.
 *
 * Bypasses the entire editor chrome (AuthBar, EcosystemNav, Dashboard
 * header / sidebar / timeline, FileMenu) and renders only the composition
 * preview + transport controls. Activated by `?embed=1` in the URL; reads
 * the composition id from the existing `?compositionId=<id>` deep-link
 * mechanism.
 *
 * Auth is intentionally NOT changed for this slice — the cloud composition
 * fetch uses whatever X-API-Token is in localStorage today. If the iframe's
 * vemotion origin doesn't have a token, the load fails and the user sees a
 * "Couldn't load…" message inside the iframe (no login UI is presented).
 */
export const EmbedView: React.FC = () => {
  const [composition, setComposition] = useState<CompositionData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'no-id'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const id = readCompositionIdFromUrl();
    if (!id) {
      setState('no-id');
      return;
    }
    setState('loading');
    getCompositionFromCloud(id)
      .then((data) => {
        setComposition(data.composition);
        setState('ready');
      })
      .catch((err: unknown) => {
        setErrorMessage(err instanceof Error ? err.message : 'unknown error');
        setState('error');
      });
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center p-4">
      {state === 'loading' && (
        <div className="text-slate-500 dark:text-slate-400 text-sm animate-pulse">Loading composition…</div>
      )}
      {state === 'no-id' && (
        <div className="text-slate-500 dark:text-slate-400 text-sm text-center max-w-md">
          No composition specified. Append <code className="text-slate-900 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-xs">?compositionId=&lt;id&gt;&amp;embed=1</code> to the URL.
        </div>
      )}
      {state === 'error' && (
        <div className="text-red-300 text-sm text-center max-w-md">
          Couldn&apos;t load composition: {errorMessage}
        </div>
      )}
      {state === 'ready' && composition && (
        <div className="w-full max-w-5xl">
          <VideoPreview composition={composition} embed />
        </div>
      )}
    </div>
  );
};
