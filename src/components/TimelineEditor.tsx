import React, { useRef, useState, useEffect, useCallback } from 'react';
import type { CompositionData, Layer } from '../lib/api';
import { Pencil, Eye, EyeOff } from 'lucide-react';
import { AddLayerModal } from './AddLayerModal';

interface TimelineEditorProps {
  composition: CompositionData;
  currentFrame: number;
  onSeek: (frame: number) => void;
  onChange: (c: CompositionData) => void;
}

type DragState =
  | { type: 'move'; layerId: string; startMouseX: number; originalStartTime: number }
  | { type: 'resize-right'; layerId: string; startMouseX: number; originalDuration: number }
  | { type: 'resize-left'; layerId: string; startMouseX: number; originalStartTime: number; originalDuration: number };

const RULER_HEIGHT = 28;
const LAYER_HEIGHT = 36;
const LAYER_GAP = 4;
const LABEL_WIDTH = 120;

function getLayerColor(layer: Layer): string {
  const c = (layer.properties.color as string) ?? '#0ea5e9';
  return c;
}

export const TimelineEditor: React.FC<TimelineEditorProps> = ({
  composition,
  currentFrame,
  onSeek,
  onChange,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => setTrackWidth(entries[0].contentRect.width));
    obs.observe(el);
    setTrackWidth(el.getBoundingClientRect().width);
    return () => obs.disconnect();
  }, []);

  const pxPerSecond = trackWidth / composition.duration;
  const currentTime = currentFrame / composition.fps;

  const timeFromX = useCallback(
    (x: number) => Math.max(0, Math.min(composition.duration, x / pxPerSecond)),
    [pxPerSecond, composition.duration]
  );

  const handleRulerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frame = Math.round(timeFromX(x) * composition.fps);
    onSeek(Math.max(0, Math.min(frame, Math.floor(composition.duration * composition.fps) - 1)));
  };

  // Document-level mouse events for drag
  useEffect(() => {
    if (!drag) return;

    const onMove = (e: MouseEvent) => {
      if (!trackRef.current) return;
      const dx = e.clientX - drag.startMouseX;
      const dt = dx / pxPerSecond;

      const layers = composition.layers.map(layer => {
        if (layer.id !== drag.layerId) return layer;

        if (drag.type === 'move') {
          const startTime = drag.originalStartTime;
          const dur = layer.layerDuration ?? (composition.duration - startTime);
          const newStart = Math.max(0, Math.min(composition.duration - dur, startTime + dt));
          return { ...layer, startTime: newStart };
        } else if (drag.type === 'resize-right') {
          const origDur = drag.originalDuration;
          const start = layer.startTime ?? 0;
          const newDur = Math.max(0.1, Math.min(composition.duration - start, origDur + dt));
          return { ...layer, layerDuration: newDur };
        } else {
          // resize-left: move start time, keep end time fixed
          const origStart = drag.originalStartTime;
          const origDur = drag.originalDuration;
          const newStart = Math.max(0, Math.min(origStart + origDur - 0.1, origStart + dt));
          const newDur = origDur - (newStart - origStart);
          return { ...layer, startTime: newStart, layerDuration: Math.max(0.1, newDur) };
        }
      });

      onChange({ ...composition, layers });
    };

    const onUp = () => setDrag(null);

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [drag, pxPerSecond, composition, onChange]);

  const startDragMove = (e: React.MouseEvent, layer: Layer) => {
    e.stopPropagation();
    setDrag({
      type: 'move',
      layerId: layer.id,
      startMouseX: e.clientX,
      originalStartTime: layer.startTime ?? 0,
    });
  };

  const startDragResizeRight = (e: React.MouseEvent, layer: Layer) => {
    e.stopPropagation();
    const startTime = layer.startTime ?? 0;
    const dur = layer.layerDuration ?? (composition.duration - startTime);
    setDrag({ type: 'resize-right', layerId: layer.id, startMouseX: e.clientX, originalDuration: dur });
  };

  const startDragResizeLeft = (e: React.MouseEvent, layer: Layer) => {
    e.stopPropagation();
    const startTime = layer.startTime ?? 0;
    const dur = layer.layerDuration ?? (composition.duration - startTime);
    setDrag({ type: 'resize-left', layerId: layer.id, startMouseX: e.clientX, originalStartTime: startTime, originalDuration: dur });
  };

  const toggleLayerVisibility = (layerId: string) => {
    onChange({
      ...composition,
      layers: composition.layers.map((layer) =>
        layer.id === layerId ? { ...layer, visible: layer.visible === false ? true : false } : layer
      ),
    });
  };

  // Ruler ticks
  const ticks: number[] = [];
  const tickInterval = composition.duration <= 10 ? 0.5 : 1;
  for (let t = 0; t <= composition.duration; t += tickInterval) {
    ticks.push(parseFloat(t.toFixed(2)));
  }

  const totalHeight = RULER_HEIGHT + composition.layers.length * (LAYER_HEIGHT + LAYER_GAP) + 8;
  const editingLayer = composition.layers.find(l => l.id === editingLayerId) ?? null;

  return (
    <>
    {editingLayer && (
      <AddLayerModal
        editingLayer={editingLayer}
        compositionDuration={composition.duration}
        compositionWidth={composition.width}
        compositionHeight={composition.height}
        onAdd={updated => onChange({ ...composition, layers: composition.layers.map(l => l.id === updated.id ? updated : l) })}
        onClose={() => setEditingLayerId(null)}
      />
    )}
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
        <span className="text-sm font-semibold text-slate-300">Timeline</span>
        <span className="text-xs text-slate-500">
          {composition.duration}s · {composition.fps}fps · {composition.layers.length} layers
        </span>
      </div>

      <div className="flex" style={{ minHeight: totalHeight }}>
        {/* Layer labels */}
        <div
          className="flex-shrink-0 border-r border-slate-800"
          style={{ width: LABEL_WIDTH, paddingTop: RULER_HEIGHT }}
        >
          {composition.layers.map(layer => (
            <div
              key={layer.id}
              className={[
                'flex items-center px-3 text-xs text-slate-400 truncate gap-1 transition',
                layer.visible === false && 'opacity-50',
              ].join(' ')}
              style={{ height: LAYER_HEIGHT, marginBottom: LAYER_GAP }}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: getLayerColor(layer) }}
              />
              <span className="truncate flex-1">{layer.id}</span>
              <button
                className="text-slate-400 hover:text-sky-400 transition flex-shrink-0 p-0.5"
                onClick={() => toggleLayerVisibility(layer.id)}
                title={layer.visible === false ? 'Show layer' : 'Hide layer'}
              >
                {layer.visible === false ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <button
                className="text-slate-400 hover:text-sky-400 transition flex-shrink-0 p-0.5"
                onClick={() => setEditingLayerId(layer.id)}
                title="Edit layer"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Track area */}
        <div ref={trackRef} className="flex-1 relative select-none overflow-hidden">

          {/* Ruler */}
          <div
            className="sticky top-0 z-10 bg-slate-900 border-b border-slate-800 cursor-pointer"
            style={{ height: RULER_HEIGHT }}
            onMouseDown={handleRulerMouseDown}
          >
            {ticks.map(t => (
              <div
                key={t}
                className="absolute top-0 flex flex-col items-center"
                style={{ left: t * pxPerSecond }}
              >
                <div className="w-px bg-slate-600" style={{ height: t % 1 === 0 ? 10 : 6, marginTop: 4 }} />
                {t % 1 === 0 && (
                  <span className="text-[10px] text-slate-500 mt-0.5">{t}s</span>
                )}
              </div>
            ))}
          </div>

          {/* Layer rows */}
          {composition.layers.map(layer => {
            const startTime = layer.startTime ?? 0;
            const dur = layer.layerDuration ?? (composition.duration - startTime);
            const left = startTime * pxPerSecond;
            const width = Math.max(4, dur * pxPerSecond);
            const color = getLayerColor(layer);

            return (
              <div
                key={layer.id}
                className="relative"
                style={{ height: LAYER_HEIGHT, marginBottom: LAYER_GAP }}
              >
                {/* Bar */}
                <div
                  className="absolute top-1 rounded cursor-grab active:cursor-grabbing flex items-center group"
                  style={{
                    left,
                    width,
                    height: LAYER_HEIGHT - 8,
                    backgroundColor: color + '33',
                    border: `1px solid ${color}88`,
                    opacity: layer.visible === false ? 0.35 : 1,
                  }}
                  onMouseDown={e => startDragMove(e, layer)}
                >
                  {/* Left resize handle */}
                  <div
                    className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-l"
                    style={{ backgroundColor: color + '66' }}
                    onMouseDown={e => startDragResizeLeft(e, layer)}
                  />

                  <span
                    className="text-[10px] px-3 truncate flex-1"
                    style={{ color }}
                  >
                    {(layer.properties.text as string) ?? layer.type}
                  </span>

                  {/* Right resize handle */}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-r"
                    style={{ backgroundColor: color + '66' }}
                    onMouseDown={e => startDragResizeRight(e, layer)}
                  />
                </div>

              </div>
            );
          })}

          {/* Playhead */}
          {trackWidth > 0 && (
            <div
              className="absolute top-0 bottom-0 w-px bg-sky-400 pointer-events-none z-20"
              style={{ left: currentTime * pxPerSecond }}
            >
              <div
                className="w-3 h-3 bg-sky-400 rotate-45 absolute -top-1"
                style={{ left: -5 }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
};
