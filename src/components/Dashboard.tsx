import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import { CompositionEditor } from './CompositionEditor';
import { VideoPreview } from './VideoPreview';
import { TimelineEditor } from './TimelineEditor';
import { FileMenu } from './FileMenu';
import { useAuth } from '../App';
import { getCompositionFromCloud, hasCloudToken, readCompositionIdFromUrl, readLastCompositionRef, saveCompositionToCloud, writeCompositionIdToUrl, writeLastCompositionRef } from '../lib/cloud-compositions';

const DEFAULT_SIDEBAR_WIDTH = 420;
const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 560;

const defaultComposition: CompositionData = {
  duration: 5,
  fps: 30,
  width: 1280,
  height: 720,
  layers: [
    {
      id: 'text-1',
      type: 'text',
      position: { x: 0, y: 260 },
      size: { width: 1280, height: 200 },
      properties: {
        text: 'Welcome to Video Generator',
        fontSize: 64,
        color: '#ffffff',
        align: 'center',
        fontWeight: '700',
      },
      animation: {
        property: 'opacity',
        keyframes: [
          { time: 0, value: 0 },
          { time: 2, value: 1 },
          { time: 4, value: 1 },
          { time: 5, value: 0 },
        ],
      },
    },
    {
      id: 'shape-1',
      type: 'shape',
      position: { x: 0, y: 0 },
      size: { width: 1280, height: 8 },
      properties: { shape: 'rect', color: '#0ea5e9' },
      animation: {
        property: 'opacity',
        keyframes: [{ time: 0, value: 0 }, { time: 0.5, value: 1 }],
      },
    },
  ],
};

export const Dashboard: React.FC = () => {
  const auth = useAuth();
  const [composition, setComposition] = useState<CompositionData>(defaultComposition);
  const [cloudCompositionId, setCloudCompositionId] = useState<string | null>(null);
  const [cloudCompositionName, setCloudCompositionName] = useState('Untitled composition');
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [autosaveVersion, setAutosaveVersion] = useState<number>(0);
  const [restoreState, setRestoreState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [seekFrame, setSeekFrame] = useState<number | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const isResizing = useRef(false);
  const lastSavedSnapshotRef = useRef(JSON.stringify(defaultComposition));
  const autosaveTimerRef = useRef<number | null>(null);
  // URL <-> composition sync: track what the URL currently reflects so the
  // sync effect only pushes a history entry on real user-driven changes.
  const urlSyncedIdRef = useRef<string | null>(null);
  // When we apply a change that already wrote the URL ourselves (initial
  // restore, deep-link, popstate handler), set this true so the sync effect
  // skips its next run.
  const skipUrlSyncRef = useRef(false);

  const handleTimelineSeek = (frame: number) => {
    setSeekFrame(frame);
    setCurrentFrame(frame);
  };

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      setSidebarWidth(Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, e.clientX)));
    };

    const onUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  useEffect(() => {
    if (!auth?.email || !hasCloudToken()) return;

    // Deep-link via `?compositionId=<id>` takes precedence over the stored last-ref.
    // On success the id is persisted as last-ref (B1) so a future visit without the
    // param reopens the same composition. On failure we keep the URL param so a
    // reload retries, do NOT touch the stored last-ref, and surface a banner.
    const deepLinkId = readCompositionIdFromUrl();
    if (deepLinkId) {
      setRestoreState('loading');
      setDeepLinkError(null);
      getCompositionFromCloud(deepLinkId)
        .then((data) => {
          // URL already carries the param — just sync our tracking ref and
          // tell the URL-sync effect to skip its next run.
          urlSyncedIdRef.current = data.id;
          skipUrlSyncRef.current = true;
          setComposition(data.composition);
          setCloudCompositionId(data.id);
          setCloudCompositionName(data.name || 'Untitled composition');
          setAutosaveVersion(data.version ?? 1);
          lastSavedSnapshotRef.current = JSON.stringify(data.composition);
          writeLastCompositionRef({ id: data.id, name: data.name || 'Untitled composition' });
          setAutosaveState('idle');
          setRestoreState('ready');
        })
        .catch((err) => {
          setDeepLinkError(`Couldn't load composition ${deepLinkId}: ${err instanceof Error ? err.message : 'unknown error'}`);
          setRestoreState('error');
        });
      return;
    }

    const lastRef = readLastCompositionRef();
    if (!lastRef?.id) {
      setRestoreState('ready');
      return;
    }

    setRestoreState('loading');
    getCompositionFromCloud(lastRef.id)
      .then((data) => {
        // Auto-restore: write the URL via replaceState (no new history entry)
        // and suppress the next URL-sync effect run.
        writeCompositionIdToUrl(data.id, 'replace');
        urlSyncedIdRef.current = data.id;
        skipUrlSyncRef.current = true;
        setComposition(data.composition);
        setCloudCompositionId(data.id);
        setCloudCompositionName(data.name || lastRef.name || 'Untitled composition');
        setAutosaveVersion(data.version ?? 1);
        lastSavedSnapshotRef.current = JSON.stringify(data.composition);
        setAutosaveState('idle');
        setRestoreState('ready');
      })
      .catch(() => {
        writeLastCompositionRef(null);
        setRestoreState('error');
      });
  }, [auth?.email]);

  // URL sync: whenever cloudCompositionId changes via a user-driven action
  // (FileMenu open, autosave-creates-id, New), push a new history entry so
  // browser back/forward navigates between compositions.
  useEffect(() => {
    if (skipUrlSyncRef.current) {
      skipUrlSyncRef.current = false;
      urlSyncedIdRef.current = cloudCompositionId;
      return;
    }
    if (urlSyncedIdRef.current === cloudCompositionId) return;
    writeCompositionIdToUrl(cloudCompositionId, 'push');
    urlSyncedIdRef.current = cloudCompositionId;
  }, [cloudCompositionId]);

  // popstate handler: when the user uses browser back/forward, read the URL
  // and load whichever composition it now points at. Suppress the URL-sync
  // effect's pushState (the browser already updated the URL).
  useEffect(() => {
    const handler = () => {
      const urlId = readCompositionIdFromUrl();
      if (urlId === urlSyncedIdRef.current) return;

      // Back to blank
      if (!urlId) {
        urlSyncedIdRef.current = null;
        skipUrlSyncRef.current = true;
        setComposition(defaultComposition);
        setCloudCompositionId(null);
        setCloudCompositionName('Untitled composition');
        setAutosaveVersion(0);
        lastSavedSnapshotRef.current = JSON.stringify(defaultComposition);
        setAutosaveState('idle');
        setCurrentFrame(0);
        setSeekFrame(0);
        return;
      }

      if (!auth?.email || !hasCloudToken()) return;

      setRestoreState('loading');
      setDeepLinkError(null);
      getCompositionFromCloud(urlId)
        .then((data) => {
          urlSyncedIdRef.current = data.id;
          skipUrlSyncRef.current = true;
          setComposition(data.composition);
          setCloudCompositionId(data.id);
          setCloudCompositionName(data.name || 'Untitled composition');
          setAutosaveVersion(data.version ?? 1);
          lastSavedSnapshotRef.current = JSON.stringify(data.composition);
          writeLastCompositionRef({ id: data.id, name: data.name || 'Untitled composition' });
          setAutosaveState('idle');
          setRestoreState('ready');
          setCurrentFrame(0);
          setSeekFrame(0);
        })
        .catch((err) => {
          setDeepLinkError(`Couldn't load composition ${urlId}: ${err instanceof Error ? err.message : 'unknown error'}`);
          setRestoreState('error');
        });
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [auth?.email]);

  useEffect(() => {
    const nextSnapshot = JSON.stringify(composition);

    if (!auth?.email || !hasCloudToken()) {
      setAutosaveState('idle');
      return;
    }

    if (nextSnapshot === lastSavedSnapshotRef.current) {
      return;
    }

    setAutosaveState('saving');
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(async () => {
      try {
        const response = await saveCompositionToCloud({
          id: cloudCompositionId,
          name: cloudCompositionName.trim() || 'Untitled composition',
          composition,
          saveType: 'autosave',
        });

        lastSavedSnapshotRef.current = nextSnapshot;
        setCloudCompositionId(response.id);
        writeLastCompositionRef({
          id: response.id,
          name: cloudCompositionName.trim() || 'Untitled composition',
        });
        setAutosaveVersion(response.version ?? autosaveVersion);
        setAutosaveState('saved');
      } catch {
        setAutosaveState('error');
      }
    }, 2500);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [auth?.email, autosaveVersion, cloudCompositionId, cloudCompositionName, composition]);

  return (
    <div className="flex flex-col flex-1">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800">
        <button
          onClick={() => setSidebarOpen(v => !v)}
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition flex-shrink-0"
          title={sidebarOpen ? 'Close panel' : 'Open panel'}
        >
          {sidebarOpen
            ? <ChevronLeft className="w-5 h-5" />
            : <ChevronRight className="w-5 h-5" />}
        </button>
        <h1 className="text-lg font-semibold text-slate-200 flex-shrink-0">Vemotion</h1>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 tracking-wide flex-shrink-0">
          Research Preview
        </span>
        <span className={[
          'text-xs px-2 py-0.5 rounded-full border flex-shrink-0',
          restoreState === 'loading' && 'bg-violet-500/10 text-violet-300 border-violet-500/30',
          restoreState === 'error' && 'bg-red-500/10 text-red-300 border-red-500/30',
          (restoreState === 'idle' || restoreState === 'ready') && 'bg-slate-800 text-slate-400 border-slate-700',
        ].join(' ')}>
          {restoreState === 'loading' ? 'Restoring…' : restoreState === 'error' ? 'Restore failed' : 'Composition mode'}
        </span>
        <span className={[
          'text-xs px-2 py-0.5 rounded-full border flex-shrink-0',
          autosaveState === 'saving' && 'bg-sky-500/10 text-sky-300 border-sky-500/30',
          autosaveState === 'saved' && 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
          autosaveState === 'error' && 'bg-red-500/10 text-red-300 border-red-500/30',
          autosaveState === 'idle' && 'bg-slate-800 text-slate-400 border-slate-700',
        ].join(' ')}>
          {autosaveState === 'saving' ? 'Autosaving…' : autosaveState === 'saved' ? `Autosaved v${autosaveVersion}` : autosaveState === 'error' ? 'Autosave failed' : 'Autosave idle'}
        </span>
        <FileMenu
          composition={composition}
          userEmail={auth?.email}
          currentCloudId={cloudCompositionId}
          currentCloudName={cloudCompositionName}
          onCloudMetaChange={({ id, name }) => {
            setCloudCompositionId(id);
            setCloudCompositionName(name || 'Untitled composition');
          }}
          onLoad={c => {
            setComposition(c);
            lastSavedSnapshotRef.current = JSON.stringify(c);
            setAutosaveState('idle');
            setCurrentFrame(0);
            setSeekFrame(0);
          }}
          onNew={() => {
            setComposition(defaultComposition);
            setCloudCompositionId(null);
            setCloudCompositionName('Untitled composition');
            writeLastCompositionRef(null);
            lastSavedSnapshotRef.current = JSON.stringify(defaultComposition);
            setAutosaveState('idle');
            setAutosaveVersion(0);
            setCurrentFrame(0);
            setSeekFrame(0);
          }}
          onCloudSaved={({ id, name, version }) => {
            setCloudCompositionId(id);
            setCloudCompositionName(name);
            lastSavedSnapshotRef.current = JSON.stringify(composition);
            setAutosaveVersion(version ?? autosaveVersion);
            setAutosaveState('saved');
          }}
        />
      </div>

      {/* Deep-link load failure banner */}
      {deepLinkError && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/30 text-red-200 text-sm flex items-center gap-3">
          <span className="flex-1">{deepLinkError}</span>
          <button
            onClick={() => setDeepLinkError(null)}
            className="px-2 py-0.5 rounded text-xs text-red-100 hover:bg-red-500/20 transition"
            title="Dismiss"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Body: sidebar + main */}
      <div className="flex flex-1 items-start relative">

        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-30"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={[
            // Mobile: fixed drawer
            'fixed inset-y-0 left-0 z-40 bg-slate-900 overflow-y-auto',
            'transition-transform duration-300 ease-in-out',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
            // Desktop: static sidebar in flow, collapses via width
            'lg:static lg:inset-auto lg:z-auto lg:translate-x-0 lg:transition-none',
            'lg:border-r lg:border-slate-800 lg:overflow-y-auto lg:self-stretch',
            !sidebarOpen && 'lg:hidden',
          ].join(' ')}
          style={{ width: sidebarWidth }}
        >
          <div className="p-4" style={{ width: sidebarWidth }}>
            <CompositionEditor composition={composition} onChange={setComposition} />
          </div>
        </aside>

        {/* Resize handle — desktop only */}
        {sidebarOpen && (
          <div
            className="hidden lg:flex w-1.5 self-stretch flex-shrink-0 cursor-col-resize bg-slate-800 hover:bg-sky-500 active:bg-sky-400 transition-colors items-center justify-center group"
            onMouseDown={startResize}
          >
            <div className="w-0.5 h-8 rounded-full bg-slate-600 group-hover:bg-sky-200 transition-colors" />
          </div>
        )}

        {/* Main: canvas + timeline */}
        <div className="flex-1 min-w-0 flex flex-col gap-4 p-4">
          <div
            className="mx-auto w-full"
            style={{ maxWidth: `calc(50vh * ${composition.width} / ${composition.height})` }}
          >
            <VideoPreview
              composition={composition}
              onFrameChange={setCurrentFrame}
              externalSeekFrame={seekFrame}
              onLayerMove={(layerId, position) => {
                // Commit the post-drag position into composition state. Flows
                // through the existing autosave pipeline automatically.
                setComposition(prev => ({
                  ...prev,
                  layers: prev.layers.map(l => l.id === layerId
                    ? { ...l, position }
                    : l),
                }));
              }}
            />
          </div>
          <TimelineEditor
            composition={composition}
            currentFrame={currentFrame}
            onSeek={handleTimelineSeek}
            onChange={setComposition}
          />
        </div>

      </div>
    </div>
  );
};
