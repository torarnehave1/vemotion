import React, { useState } from 'react';
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
      properties: {
        shape: 'rect',
        color: '#0ea5e9',
      },
      animation: {
        property: 'opacity',
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.5, value: 1 },
        ],
      },
    },
  ],
};

export const Dashboard: React.FC = () => {
  const auth = useAuth();
  const [composition, setComposition] = useState<CompositionData>(defaultComposition);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [seekFrame, setSeekFrame] = useState<number | undefined>(undefined);

  const handleTimelineSeek = (frame: number) => {
    setSeekFrame(frame);
    setCurrentFrame(frame);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-200">Vemotion</h1>
        <FileMenu
          composition={composition}
          userEmail={auth?.email}
          onLoad={c => { setComposition(c); setCurrentFrame(0); setSeekFrame(0); }}
          onNew={() => { setComposition(defaultComposition); setCurrentFrame(0); setSeekFrame(0); }}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CompositionEditor
          composition={composition}
          onChange={setComposition}
        />
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
  );
};
