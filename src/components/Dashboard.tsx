import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Play, Square } from 'lucide-react';
import type { CompositionData, Layer } from '../lib/api';
import { CompositionEditor } from './CompositionEditor';
import { VideoPreview } from './VideoPreview';
import { TimelineEditor } from './TimelineEditor';
import { FileMenu } from './FileMenu';
import { useAuth } from '../App';
import { getCompositionFromCloud, hasCloudToken, readCompositionIdFromUrl, readLastCompositionRef, saveCompositionToCloud, writeCompositionIdToUrl, writeLastCompositionRef } from '../lib/cloud-compositions';
import { type StreamSettings } from './PathStreamPanel';

// Lighten a hex colour toward white (used for the trailing density dots).
function lighten(hex: string, amt = 0.5): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.round(r + (255 - r) * amt); g = Math.round(g + (255 - g) * amt); b = Math.round(b + (255 - b) * amt);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}


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
  // Shared single-layer selection so the canvas (VideoPreview) and the timeline
  // layer rows (TimelineEditor) highlight the same layer. Canvas click pushes up
  // via onSelectLayer; a timeline row click pushes the same id, which flows back
  // down to the canvas — selection stays in sync both ways.
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  // Slice 2: rebuild a path + its follower dots from the Path-stream panel —
  // colour (path stroke + dots), speed (cycle), density (phase-offset dots),
  // start/stop window. One composition update; rides autosave.
  const applyPathStream = useCallback((pathId: string, st: StreamSettings) => {
    setComposition((prev) => {
      const winStart = +st.start.toFixed(2);
      const winEnd = Math.max(winStart + 0.5, +st.end.toFixed(2));
      const winDur = +(winEnd - winStart).toFixed(2);
      const C = Math.max(0.1, st.cycle);
      const density = Math.max(1, Math.min(12, Math.round(st.density)));
      const light = lighten(st.color);
      const mkCycles = (durTotal: number) => {
        const sc: Array<{ start: number; end: number; pathLayerId: string }> = [];
        for (let c = 0; c < durTotal - 1e-6; c += C) sc.push({ start: +c.toFixed(3), end: +Math.min(c + C, durTotal).toFixed(3), pathLayerId: pathId });
        return sc;
      };
      const isDot = (l: Layer) => l.type === 'shape'
        && Array.isArray((l.properties as Record<string, unknown>)?.motionScenes)
        && ((l.properties as Record<string, unknown>).motionScenes as Array<{ pathLayerId?: string }>).some((s) => s?.pathLayerId === pathId);
      // drop the old follower dots, recolour + rewindow the path
      const layers = prev.layers.filter((l) => !isDot(l)).map((l) => l.id === pathId
        ? { ...l, startTime: winStart, layerDuration: winDur, properties: { ...l.properties, strokeColor: st.color } }
        : l);
      // build the new density stream, phase-offset across one cycle
      const dots: Layer[] = [];
      for (let j = 0; j < density; j++) {
        const ds = +(winStart + j * (C / density)).toFixed(2);
        const dd = +(winEnd - ds).toFixed(2);
        if (dd <= 0) continue;
        dots.push({
          id: `${pathId}-stream-${j}`, type: 'shape', position: { x: 0, y: 0 },
          size: { width: j === 0 ? 14 : 12, height: j === 0 ? 14 : 12 },
          startTime: ds, layerDuration: dd,
          properties: { shape: 'circle', color: j === 0 ? st.color : light, opacity: j === 0 ? 1 : 0.9, strokeColor: '#0c4a6e', strokeWidth: 2, motionScenes: mkCycles(dd) },
        });
      }
      const i = layers.findIndex((l) => l.id === pathId);
      layers.splice(i + 1, 0, ...dots);
      return { ...prev, layers };
    });
  }, []);
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

  // ── In-place "build-up replay" ────────────────────────────────────────────
  // Drives the REAL editor: clears the live composition to zero layers, then
  // adds the original layers back one per interval, so the canvas + timeline
  // visibly assemble themselves. The user points their own screen recorder at
  // the unchanged app. Autosave is paused while replaying (replayingRef) so the
  // half-built intermediate states never reach the cloud; the full composition
  // is restored at the end (final slice === full script) and on Stop/unmount.
  const [replayActive, setReplayActive] = useState(false);
  const [replayStep, setReplayStep] = useState(0);
  const [replayTotal, setReplayTotal] = useState(0);
  const [replaySec, setReplaySec] = useState(1);
  const replayingRef = useRef(false);
  const replayScriptRef = useRef<Layer[]>([]);
  const replayTimerRef = useRef<number | null>(null);

  const finishReplay = useCallback(() => {
    if (replayTimerRef.current) { window.clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    // Restore the full composition (no-op if the last tick already did).
    const script = replayScriptRef.current;
    setComposition(c => ({ ...c, layers: script }));
    replayingRef.current = false;
    setReplayActive(false);
  }, []);

  const startReplay = useCallback(() => {
    if (replayingRef.current) return;
    const script = composition.layers;
    if (script.length === 0) return;
    // Cancel any pending autosave so it can't fire mid-replay.
    if (autosaveTimerRef.current) { window.clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null; }
    replayScriptRef.current = script;
    replayingRef.current = true;
    setReplayTotal(script.length);
    setReplayStep(0);
    setReplayActive(true);
    setComposition(c => ({ ...c, layers: [] }));
    let step = 0;
    replayTimerRef.current = window.setInterval(() => {
      step += 1;
      setComposition(c => ({ ...c, layers: script.slice(0, step) }));
      setReplayStep(step);
      if (step >= script.length) {
        if (replayTimerRef.current) { window.clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
        // Last slice already equals the full script; just lift the pause.
        replayingRef.current = false;
        setReplayActive(false);
      }
    }, Math.max(200, replaySec * 1000));
  }, [composition.layers, replaySec]);

  // Safety: if Dashboard unmounts mid-replay, stop the timer and restore.
  useEffect(() => () => {
    if (replayTimerRef.current) window.clearInterval(replayTimerRef.current);
    if (replayingRef.current) {
      replayingRef.current = false;
      setComposition(c => ({ ...c, layers: replayScriptRef.current }));
    }
  }, []);

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
    // Paused during build-up replay so half-built states never hit the cloud.
    if (replayingRef.current) return;

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

        {/* Build-up replay: rebuilds the live composition one layer per interval
            in the real editor, for screen recording. Autosave pauses while it runs. */}
        {!replayActive ? (
          <button
            onClick={startReplay}
            title="Replay build-up — re-add layers one per second in the editor (for screen recording)"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm rounded-lg border border-slate-700 transition flex-shrink-0"
          >
            <Play className="w-3.5 h-3.5" /> Replay
          </button>
        ) : (
          <button
            onClick={finishReplay}
            title="Stop replay and restore the full composition"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-sm rounded-lg transition flex-shrink-0"
          >
            <Square className="w-3.5 h-3.5" /> Stop {replayStep}/{replayTotal}
          </button>
        )}
        <label className="flex items-center gap-1 text-xs text-slate-500 flex-shrink-0" title="Seconds between each layer">
          <input
            type="number" min={0.2} step={0.1} value={replaySec}
            disabled={replayActive}
            onChange={e => setReplaySec(Math.max(0.2, parseFloat(e.target.value) || 1))}
            className="w-12 bg-slate-800 border border-slate-700 text-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
          />
          s
        </label>
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
            <CompositionEditor composition={composition} onChange={setComposition} currentFrame={currentFrame} />
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
              selectedLayerId={selectedLayerId}
              onSelectLayer={setSelectedLayerId}
              onUpdatePathStream={applyPathStream}
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
              onLayerResize={(layerId, position, size) => {
                // Commit the post-resize position + size. Spread-and-override so
                // every other layer field survives (Lesson 21). Rides autosave.
                setComposition(prev => ({
                  ...prev,
                  layers: prev.layers.map(l => l.id === layerId
                    ? { ...l, position, size }
                    : l),
                }));
              }}
              onAddLayers={(layers) => {
                // Append new layers to the composition (in order — last is
                // on top). Used by the Pen Tool: emits [pathLayer, dotLayer]
                // so the user immediately sees the dot drive along the path
                // they just authored.
                setComposition(prev => ({
                  ...prev,
                  layers: [...prev.layers, ...layers],
                }));
              }}
              onUpdatePathAnchors={(layerId, anchors) => {
                // Post-commit path editing — write a new anchors array into
                // the specified path layer's properties. Drives through the
                // existing autosave pipeline (debounced 2.5s).
                setComposition(prev => ({
                  ...prev,
                  layers: prev.layers.map(l => l.id === layerId
                    ? { ...l, properties: { ...l.properties, anchors } }
                    : l),
                }));
              }}
              onUpdateLayerMask={(layerId, mask) => {
                // Set an image layer's clip mask. Spread-and-override so every
                // other property survives (Lesson 21). Rides autosave.
                setComposition(prev => ({
                  ...prev,
                  layers: prev.layers.map(l => l.id === layerId
                    ? { ...l, properties: { ...l.properties, mask } }
                    : l),
                }));
              }}
              onSetMaskFeather={(layerId, feather) => {
                // Update only the feather on an image layer's existing mask.
                // Spread-and-override (Lesson 21); 0 → delete the key (hard edge).
                setComposition(prev => ({
                  ...prev,
                  layers: prev.layers.map(l => {
                    if (l.id !== layerId) return l;
                    const props = l.properties as Record<string, unknown>;
                    if (!props.mask) return l;
                    const nextMask = { ...(props.mask as Record<string, unknown>) };
                    if (feather > 0) nextMask.feather = feather; else delete nextMask.feather;
                    return { ...l, properties: { ...l.properties, mask: nextMask } };
                  }),
                }));
              }}
              onSetMaskInvert={(layerId, invert) => {
                // Toggle invert on an image layer's existing mask. Spread-and-
                // override (Lesson 21); false → delete the key (keep inside).
                setComposition(prev => ({
                  ...prev,
                  layers: prev.layers.map(l => {
                    if (l.id !== layerId) return l;
                    const props = l.properties as Record<string, unknown>;
                    if (!props.mask) return l;
                    const nextMask = { ...(props.mask as Record<string, unknown>) };
                    if (invert) nextMask.invert = true; else delete nextMask.invert;
                    return { ...l, properties: { ...l.properties, mask: nextMask } };
                  }),
                }));
              }}
              onRemoveLayerMask={(layerId) => {
                // Remove an image layer's clip mask. Strip via delete on a spread
                // copy so every OTHER property survives (Lesson 21, point 2 —
                // delete, don't rebuild). Rides autosave.
                setComposition(prev => ({
                  ...prev,
                  layers: prev.layers.map(l => {
                    if (l.id !== layerId) return l;
                    const properties = { ...l.properties };
                    delete properties.mask;
                    return { ...l, properties };
                  }),
                }));
              }}
              onAddPatch={(layerId, patch) => {
                // Append a clone patch to an image layer's properties.patches[].
                // Spread-and-override so every other property survives (Lesson 21);
                // multiple patches accumulate (one per blemish). Rides autosave.
                setComposition(prev => ({
                  ...prev,
                  layers: prev.layers.map(l => {
                    if (l.id !== layerId) return l;
                    const props = l.properties as Record<string, unknown>;
                    const existing = Array.isArray(props.patches) ? (props.patches as unknown[]) : [];
                    return { ...l, properties: { ...l.properties, patches: [...existing, patch] } };
                  }),
                }));
              }}
              onClearPatches={(layerId) => {
                // Remove all clone patches. Strip via delete on a spread copy so
                // every OTHER property survives (Lesson 21 point 2). Rides autosave.
                setComposition(prev => ({
                  ...prev,
                  layers: prev.layers.map(l => {
                    if (l.id !== layerId) return l;
                    const properties = { ...l.properties };
                    delete properties.patches;
                    return { ...l, properties };
                  }),
                }));
              }}
              onUpdateGuides={(guides) => {
                // Persist ruler guides into composition.meta.guides. Editor-only
                // (excluded from MP4 export); rides the existing autosave.
                setComposition(prev => ({
                  ...prev,
                  meta: { ...prev.meta, guides },
                }));
              }}
            />
          </div>
          <TimelineEditor
            composition={composition}
            currentFrame={currentFrame}
            onSeek={handleTimelineSeek}
            onChange={setComposition}
            selectedLayerId={selectedLayerId}
            onSelectLayer={setSelectedLayerId}
          />
        </div>

      </div>
    </div>
  );
};
