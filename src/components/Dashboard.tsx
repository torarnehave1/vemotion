import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import { CompositionEditor } from './CompositionEditor';
import { VideoPreview } from './VideoPreview';
import { TimelineEditor } from './TimelineEditor';
import { FileMenu } from './FileMenu';
import { useAuth } from '../App';
import { getCompositionFromCloud, hasCloudToken, readLastCompositionRef, saveCompositionToCloud, writeLastCompositionRef } from '../lib/cloud-compositions';

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
  const [currentFrame, setCurrentFrame] = useState(0);
  const [seekFrame, setSeekFrame] = useState<number | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const isResizing = useRef(false);
  const lastSavedSnapshotRef = useRef(JSON.stringify(defaultComposition));
  const autosaveTimerRef = useRef<number | null>(null);

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

    const lastRef = readLastCompositionRef();
    if (!lastRef?.id) {
      setRestoreState('ready');
      return;
    }

    setRestoreState('loading');
    getCompositionFromCloud(lastRef.id)
      .then((data) => {
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
