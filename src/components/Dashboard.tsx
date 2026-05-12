import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import { CompositionEditor } from './CompositionEditor';
import { VideoPreview } from './VideoPreview';
import { TimelineEditor } from './TimelineEditor';
import { FileMenu } from './FileMenu';
import { useAuth } from '../App';

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

  const handleTimelineSeek = (frame: number) => {
    setSeekFrame(frame);
    setCurrentFrame(frame);
  };

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
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

      {/* Body */}
      <div className="flex gap-4 items-start relative">

        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-30"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar — fixed drawer on mobile, layout panel on desktop */}
        <aside
          className={[
            // Mobile: fixed drawer sliding in from left
            'fixed inset-y-0 left-0 z-40 w-80 overflow-y-auto bg-slate-950 px-4 py-6',
            'transition-transform duration-300 ease-in-out',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
            // Desktop: static panel in the flex layout, collapses via width
            'lg:static lg:inset-auto lg:z-auto lg:bg-transparent lg:p-0',
            'lg:translate-x-0 lg:transition-all lg:duration-300 lg:overflow-hidden lg:flex-shrink-0',
            sidebarOpen ? 'lg:w-80' : 'lg:w-0',
          ].join(' ')}
        >
          {/* Inner wrapper keeps CompositionEditor at full width during collapse animation */}
          <div className="w-80">
            <CompositionEditor composition={composition} onChange={setComposition} />
          </div>
        </aside>

        {/* Canvas + Timeline */}
        <div className="flex-1 min-w-0 space-y-4 w-full">
          <VideoPreview
            composition={composition}
            onFrameChange={setCurrentFrame}
            externalSeekFrame={seekFrame}
          />
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
