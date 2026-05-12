import React, { useState, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import { CompositionEditor } from './CompositionEditor';
import { VideoPreview } from './VideoPreview';
import { TimelineEditor } from './TimelineEditor';
import { FileMenu } from './FileMenu';
import { useAuth } from '../App';

const DEFAULT_SIDEBAR_WIDTH = 320;
const MIN_SIDEBAR_WIDTH = 240;
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
  const [currentFrame, setCurrentFrame] = useState(0);
  const [seekFrame, setSeekFrame] = useState<number | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const isResizing = useRef(false);

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

  return (
    <div className="flex flex-col h-full">

      {/* Header bar — full width */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title={sidebarOpen ? 'Close panel' : 'Open panel'}
          >
            {sidebarOpen
              ? <ChevronLeft className="w-5 h-5" />
              : <ChevronRight className="w-5 h-5" />}
          </button>
          <h1 className="text-lg font-semibold text-slate-200">Vemotion</h1>
        </div>
        <FileMenu
          composition={composition}
          userEmail={auth?.email}
          onLoad={c => { setComposition(c); setCurrentFrame(0); setSeekFrame(0); }}
          onNew={() => { setComposition(defaultComposition); setCurrentFrame(0); setSeekFrame(0); }}
        />
      </div>

      {/* Body — sidebar + content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

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
            // Desktop: layout panel, no transition on width (resize is instant)
            'lg:static lg:inset-auto lg:z-auto lg:translate-x-0',
            'lg:border-r lg:border-slate-800 lg:flex-shrink-0 lg:overflow-y-auto',
            !sidebarOpen && 'lg:hidden',
          ].join(' ')}
          style={{ width: sidebarWidth }}
        >
          <div className="p-4" style={{ width: sidebarWidth }}>
            <CompositionEditor composition={composition} onChange={setComposition} />
          </div>
        </aside>

        {/* Resize handle — desktop only, visible when sidebar is open */}
        {sidebarOpen && (
          <div
            className="hidden lg:flex w-1.5 flex-shrink-0 cursor-col-resize bg-slate-800 hover:bg-sky-500 active:bg-sky-400 transition-colors duration-150 items-center justify-center group"
            onMouseDown={startResize}
            title="Drag to resize"
          >
            <div className="w-0.5 h-8 rounded-full bg-slate-600 group-hover:bg-sky-300 transition-colors" />
          </div>
        )}

        {/* Main content: canvas + timeline */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 p-4 pb-2">
            <VideoPreview
              composition={composition}
              onFrameChange={setCurrentFrame}
              externalSeekFrame={seekFrame}
            />
          </div>
          <div className="flex-shrink-0 px-4 pb-4">
            <TimelineEditor
              composition={composition}
              currentFrame={currentFrame}
              onSeek={handleTimelineSeek}
              onChange={setComposition}
            />
          </div>
        </div>

      </div>
    </div>
  );
};
