import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, Square, Download } from 'lucide-react';
import { CanvasRenderer, PlaybackController } from '../lib/renderer';
import type { CompositionData, Layer } from '../lib/api';

interface VideoPreviewProps {
  composition: CompositionData;
  onFrameChange?: (frame: number) => void;
  externalSeekFrame?: number;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({ composition, onFrameChange, externalSeekFrame }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const controllerRef = useRef<PlaybackController | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);

  const totalFrames = Math.floor(composition.duration * composition.fps);

  // Initialise renderer when canvas is ready
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new CanvasRenderer(canvas);
    const controller = new PlaybackController(renderer, composition);

    controller.onFrameChange = (frame) => {
      setCurrentFrame(frame);
      onFrameChange?.(frame);
    };
    controller.onEnd = () => setIsPlaying(false);

    rendererRef.current = renderer;
    controllerRef.current = controller;

    // Render first frame immediately
    void renderer.renderFrame(composition, 0);
    setCurrentFrame(0);

    return () => controller.pause();
  }, [composition]);

  // Seek when timeline sends a frame
  useEffect(() => {
    if (externalSeekFrame === undefined) return;
    controllerRef.current?.pause();
    controllerRef.current?.seekToFrame(externalSeekFrame);
    setIsPlaying(false);
    setCurrentFrame(externalSeekFrame);
  }, [externalSeekFrame]);

  const handlePlay = useCallback(() => {
    controllerRef.current?.play();
    setIsPlaying(true);
  }, []);

  const handlePause = useCallback(() => {
    controllerRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const handleStop = useCallback(() => {
    controllerRef.current?.stop();
    setIsPlaying(false);
    setCurrentFrame(0);
  }, []);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const frame = parseInt(e.target.value);
    controllerRef.current?.pause();
    controllerRef.current?.seekToFrame(frame);
    setIsPlaying(false);
    setCurrentFrame(frame);
  }, []);

  const currentTime = (currentFrame / composition.fps).toFixed(2);
  const totalTime = composition.duration.toFixed(2);
  const progressPct = totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 0;
  const currentTimeSeconds = currentFrame / composition.fps;
  const svgLayers = composition.layers.filter((layer) => layer.type === 'svg-animation');

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">

      {/* Canvas */}
      <div className="flex justify-center">
        <div
          className="relative bg-black rounded-lg overflow-hidden"
          style={{
            aspectRatio: `${composition.width}/${composition.height}`,
            maxHeight: '50vh',
            width: `min(100%, calc(50vh * ${composition.width} / ${composition.height}))`,
          }}
        >
          <canvas ref={canvasRef} className="w-full h-full" />
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {svgLayers.map((layer) => (
              <LiveSvgLayer
                key={layer.id}
                layer={layer}
                composition={composition}
                currentTime={currentTimeSeconds}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Scrubber */}
      <div className="space-y-2">
        <input
          type="range"
          min={0}
          max={totalFrames - 1}
          value={currentFrame}
          onChange={handleScrub}
          className="w-full accent-sky-500"
        />
        <div className="flex justify-between text-xs text-slate-400">
          <span>Frame {currentFrame} / {totalFrames}</span>
          <span>{currentTime}s / {totalTime}s</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-slate-800 rounded-full h-1">
        <div
          className="bg-sky-600 h-1 rounded-full transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        {isPlaying ? (
          <button
            onClick={handlePause}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition"
          >
            <Pause className="w-4 h-4" /> Pause
          </button>
        ) : (
          <button
            onClick={handlePlay}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition"
          >
            <Play className="w-4 h-4" /> Play
          </button>
        )}
        <button
          onClick={handleStop}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition"
        >
          <Square className="w-4 h-4" /> Stop
        </button>
        <div className="ml-auto">
          <button className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition">
            <Download className="w-4 h-4" /> Export MP4
          </button>
        </div>
      </div>

      {/* Composition info */}
      <div className="flex gap-4 text-xs text-slate-500 pt-2 border-t border-slate-800">
        <span>{composition.width}×{composition.height}</span>
        <span>{composition.fps} fps</span>
        <span>{composition.duration}s</span>
        <span>{composition.layers.length} layer{composition.layers.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
};

const LiveSvgLayer: React.FC<{
  layer: Layer;
  composition: CompositionData;
  currentTime: number;
}> = ({ layer, composition, currentTime }) => {
  const startTime = layer.startTime ?? 0;
  const layerDuration = layer.layerDuration ?? (composition.duration - startTime);
  const localTime = currentTime - startTime;

  if (localTime < 0 || localTime > layerDuration) return null;

  const svg = (layer.properties.svg as string) ?? '';
  if (!svg) return null;

  const duration = typeof layer.properties.duration === 'number'
    ? (layer.properties.duration as number)
    : layerDuration;

  const opacity = resolveAnimatedNumber(layer, currentTime, 'opacity', 1);
  const scale = resolveAnimatedNumber(layer, currentTime, 'scale', 1);
  const offsetX = resolveAnimatedNumber(layer, currentTime, 'offsetX', 0);
  const offsetY = resolveAnimatedNumber(layer, currentTime, 'offsetY', 0);

  const loopedTime = duration > 0 ? ((localTime % duration) + duration) % duration : localTime;
  const html = svg
    .replace(/<svg\b/, `<svg data-ve-time="${loopedTime.toFixed(4)}"`)
    .replace(/(<svg\b[^>]*)(>)/, `$1 style="width:100%;height:100%;display:block;"$2`);

  return (
    <div
      className="absolute"
      style={{
        left: `${(layer.position.x / composition.width) * 100}%`,
        top: `${(layer.position.y / composition.height) * 100}%`,
        width: `${(layer.size.width / composition.width) * 100}%`,
        height: `${(layer.size.height / composition.height) * 100}%`,
        opacity,
        transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
        transformOrigin: 'center center',
      }}
    >
      <div
        className="w-full h-full"
        dangerouslySetInnerHTML={{ __html: html }}
        ref={(node) => {
          const svgEl = node?.querySelector('svg') as SVGSVGElement | null;
          if (!svgEl) return;
          try {
            svgEl.pauseAnimations?.();
            svgEl.setCurrentTime?.(loopedTime);
          } catch {
            // ignore
          }
          try {
            const animations = svgEl.getAnimations?.({ subtree: true }) ?? [];
            for (const animation of animations) {
              animation.pause();
              animation.currentTime = loopedTime * 1000;
            }
          } catch {
            // ignore
          }
        }}
      />
    </div>
  );
};

function resolveAnimatedNumber(layer: Layer, currentTime: number, property: string, fallback: number): number {
  const startTime = layer.startTime ?? 0;
  const localTime = currentTime - startTime;
  const animations = [
    ...(layer.animation && layer.animation.property === property ? [layer.animation] : []),
    ...((layer.animations ?? []).filter((anim) => anim.property === property)),
  ];

  if (animations.length === 0) return fallback;
  const keyframes = animations[0].keyframes;
  if (keyframes.length === 0) return fallback;
  if (keyframes.length === 1) return Number(keyframes[0].value ?? fallback);

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (localTime <= sorted[0].time) return Number(sorted[0].value ?? fallback);
  if (localTime >= sorted[sorted.length - 1].time) return Number(sorted[sorted.length - 1].value ?? fallback);

  const afterIndex = sorted.findIndex((frame) => frame.time > localTime);
  if (afterIndex <= 0) return Number(sorted[0].value ?? fallback);
  const before = sorted[afterIndex - 1];
  const after = sorted[afterIndex];
  const progress = (localTime - before.time) / (after.time - before.time);
  return Number(before.value) + (Number(after.value) - Number(before.value)) * progress;
}
