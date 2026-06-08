import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, RotateCcw, SkipBack, SkipForward, X, Eye, EyeOff, Captions } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import { layerLabel } from '../lib/api';
import { CanvasRenderer } from '../lib/renderer';

interface StagedRevealPlayerProps {
  composition: CompositionData;
  /** Frame the reveal is frozen at. Defaults to the editor's current playhead. */
  initialFrame?: number;
  onClose: () => void;
}

/**
 * Full-screen "build-up replay": reads the current composition and reveals its
 * layers one at a time on a timed interval, frozen at a single frame, so the
 * picture visibly assembles itself. No MP4 export — the user points their own
 * screen recorder at this surface. No storage, no backend.
 *
 * Reveal mechanic reuses CanvasRenderer as-is: each step renders a derived
 * composition `{ ...composition, layers: revealable.slice(0, step) }` (Lesson 21
 * spread-and-override keeps every composition field intact). Hidden layers are
 * skipped so they don't waste a step.
 */
export const StagedRevealPlayer: React.FC<StagedRevealPlayerProps> = ({
  composition,
  initialFrame = 0,
  onClose,
}) => {
  // Visible layers only, in array (z / timeline-rail) order.
  const revealable = useMemo(
    () => composition.layers.filter((l) => l.visible !== false),
    [composition.layers],
  );
  const total = revealable.length;
  const maxFrame = Math.max(0, Math.floor(composition.duration * composition.fps) - 1);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const [ready, setReady] = useState(false);

  const [step, setStep] = useState(total); // open showing the finished picture
  const [playing, setPlaying] = useState(false);
  const [intervalMs, setIntervalMs] = useState(1000);
  const [freezeFrame, setFreezeFrame] = useState(Math.min(Math.max(0, initialFrame), maxFrame));
  const [showControls, setShowControls] = useState(true);
  const [showCaption, setShowCaption] = useState(false);

  // Build the renderer once and preload assets on the FULL composition so every
  // frame draw has them cached.
  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new CanvasRenderer(canvasRef.current);
    rendererRef.current = renderer;
    let cancelled = false;
    (async () => {
      await renderer.preloadImages(composition);
      await renderer.preloadVideos(composition);
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, [composition]);

  // Render the current cumulative slice whenever step / frame / readiness change.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !ready) return;
    const derived: CompositionData = { ...composition, layers: revealable.slice(0, step) };
    renderer.renderFrame(derived, freezeFrame);
  }, [ready, step, freezeFrame, revealable, composition]);

  // Auto-advance while playing; stop at the end.
  useEffect(() => {
    if (!playing) return;
    if (step >= total) { setPlaying(false); return; }
    const id = window.setInterval(() => {
      setStep((s) => {
        if (s >= total) { return s; }
        return s + 1;
      });
    }, Math.max(100, intervalMs));
    return () => window.clearInterval(id);
  }, [playing, intervalMs, total, step]);

  const play = () => {
    // "Play from start" if we're already at the end.
    if (step >= total) setStep(0);
    setPlaying(true);
  };
  const pause = () => setPlaying(false);
  const restart = () => { setPlaying(false); setStep(0); };
  const prev = () => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); };
  const next = () => { setPlaying(false); setStep((s) => Math.min(total, s + 1)); };

  // Keyboard: Esc close, Space play/pause, ←/→ step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); }
      else if (e.key === ' ') { e.preventDefault(); playing ? pause() : play(); }
      else if (e.key === 'ArrowRight') { next(); }
      else if (e.key === 'ArrowLeft') { prev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const caption = step > 0 ? layerLabel(revealable[step - 1]) : '';

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black flex flex-col items-center justify-center">
      {/* Close (hidden along with controls for a clean recording) */}
      {showControls && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition z-10"
          title="Close (Esc)"
        >
          <X className="w-6 h-6" />
        </button>
      )}

      {/* Canvas — intrinsic size = composition size; scaled to fit the viewport. */}
      <div className="flex-1 w-full flex items-center justify-center p-4 min-h-0">
        <canvas
          ref={canvasRef}
          style={{ maxWidth: '92vw', maxHeight: showControls ? '78vh' : '94vh', width: 'auto', height: 'auto' }}
          className="shadow-2xl"
        />
      </div>

      {/* Optional caption — the just-added layer */}
      {showCaption && caption && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-black/60 text-white text-sm rounded-full">
          {caption}
        </div>
      )}

      {/* When controls are hidden, a tiny affordance to bring them back. */}
      {!showControls && (
        <button
          onClick={() => setShowControls(true)}
          className="absolute bottom-3 right-3 text-slate-600 hover:text-slate-300 transition"
          title="Show controls"
        >
          <Eye className="w-4 h-4" />
        </button>
      )}

      {showControls && (
        <div className="w-full max-w-3xl mb-5 px-4">
          <div className="flex items-center gap-3 bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-3">
            <button onClick={restart} title="Restart" className="text-slate-300 hover:text-white transition"><RotateCcw className="w-4 h-4" /></button>
            <button onClick={prev} title="Previous layer (←)" className="text-slate-300 hover:text-white transition"><SkipBack className="w-4 h-4" /></button>
            <button
              onClick={() => (playing ? pause() : play())}
              title="Play / Pause (Space)"
              className="flex items-center justify-center w-9 h-9 rounded-full bg-sky-600 hover:bg-sky-500 text-white transition"
            >
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button onClick={next} title="Next layer (→)" className="text-slate-300 hover:text-white transition"><SkipForward className="w-4 h-4" /></button>

            <span className="text-xs text-slate-400 tabular-nums w-14 text-center">{step} / {total}</span>

            {/* Interval */}
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>sec/step</span>
              <input
                type="number" min={0.1} step={0.1}
                value={(intervalMs / 1000).toString()}
                onChange={(e) => setIntervalMs(Math.max(100, (parseFloat(e.target.value) || 1) * 1000))}
                className="w-14 bg-slate-800 border border-slate-700 text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </label>

            {/* Freeze frame */}
            <label className="flex items-center gap-1.5 text-xs text-slate-400 flex-1 min-w-0">
              <span className="whitespace-nowrap">frame</span>
              <input
                type="range" min={0} max={maxFrame} value={freezeFrame}
                onChange={(e) => setFreezeFrame(parseInt(e.target.value))}
                className="flex-1 min-w-0 accent-sky-500"
              />
              <span className="tabular-nums w-10 text-right">{freezeFrame}</span>
            </label>

            <button
              onClick={() => setShowCaption((v) => !v)}
              title="Toggle layer caption"
              className={`transition ${showCaption ? 'text-sky-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <Captions className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowControls(false)}
              title="Hide controls (for recording)"
              className="text-slate-500 hover:text-slate-300 transition"
            >
              <EyeOff className="w-4 h-4" />
            </button>
          </div>
          {!ready && <p className="text-center text-xs text-slate-500 mt-2">Loading assets…</p>}
        </div>
      )}
    </div>,
    document.body,
  );
};
