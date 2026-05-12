import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import type { Layer } from '../lib/api';

const KG_BASE = 'https://knowledge.vegvisr.org';
const ANIM_GRAPH = 'vemotion-animations';

interface SceneElement {
  type: 'text' | 'shape';
  id: string;
  content?: string;
  shape?: 'rect' | 'circle';
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  fontWeight?: number;
  color: string;
  align?: 'left' | 'center' | 'right';
  borderRadius?: number;
  animation: {
    property: string;
    delay: number;
    duration: number;
  };
}

interface SceneInfo {
  type: 'scene';
  duration: number;
  background?: string;
  elements: SceneElement[];
}

interface CssAnimSpec {
  id: string;
  label: string;
  color: string;
  cssAnim: string;
  duration: string;
}

type ParsedAnimation =
  | { kind: 'scene'; nodeId: string; label: string; color: string; scene: SceneInfo }
  | { kind: 'css';   nodeId: string; label: string; color: string; spec: CssAnimSpec };

interface AnimationPortfolioModalProps {
  onAddLayers: (layers: Layer[]) => void;
  onClose: () => void;
  compositionWidth: number;
  compositionHeight: number;
}

const PREVIEW_W = 280;
const PREVIEW_H = 158;

function generateId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function parseNodeInfo(node: { id: string; label: string; color: string; info: string }): ParsedAnimation[] {
  if (!node.info) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(node.info);
  } catch {
    return [];
  }
  if (parsed && typeof parsed === 'object' && (parsed as SceneInfo).type === 'scene') {
    return [{ kind: 'scene', nodeId: node.id, label: node.label, color: node.color, scene: parsed as SceneInfo }];
  }
  if (Array.isArray(parsed)) {
    return (parsed as CssAnimSpec[])
      .filter(s => s && s.cssAnim && s.id && s.label)
      .map(s => ({ kind: 'css' as const, nodeId: node.id, label: s.label, color: s.color || node.color, spec: s }));
  }
  return [];
}

function sceneToLayers(scene: SceneInfo, cw: number, ch: number): Layer[] {
  return scene.elements.map(el => {
    const absW = el.width;
    const absH = el.height;
    const absX = Math.round(el.x * cw - absW / 2);
    const absY = Math.round(el.y * ch - absH / 2);

    const startTime = el.animation.delay;
    const endTime   = el.animation.delay + el.animation.duration;
    const animation = {
      property: el.animation.property,
      keyframes: [
        { time: 0, value: 0 },
        { time: startTime, value: 0 },
        { time: endTime,   value: 1 },
      ],
    };

    if (el.type === 'text') {
      return {
        id: generateId('text'),
        type: 'text' as const,
        position: { x: absX, y: absY },
        size: { width: absW, height: absH },
        animation,
        properties: {
          text: el.content ?? el.id,
          fontSize: el.fontSize ?? 36,
          color: el.color,
          align: el.align ?? 'center',
          fontWeight: String(el.fontWeight ?? 600),
        },
      };
    }

    return {
      id: generateId('shape'),
      type: 'shape' as const,
      position: { x: absX, y: absY },
      size: { width: absW, height: absH },
      animation,
      properties: {
        shape: el.shape ?? 'rect',
        color: el.color,
        ...(el.borderRadius ? { borderRadius: el.borderRadius } : {}),
      },
    };
  });
}

function cssToLayer(spec: CssAnimSpec, cw: number, ch: number): Layer {
  const w = 200, h = 200;
  return {
    id: generateId('shape'),
    type: 'shape' as const,
    position: { x: Math.round((cw - w) / 2), y: Math.round((ch - h) / 2) },
    size: { width: w, height: h },
    animation: { property: 'opacity', keyframes: [{ time: 0, value: 0 }, { time: 0.8, value: 1 }] },
    properties: { shape: 'circle', color: spec.color },
  };
}

const ScenePreview: React.FC<{ scene: SceneInfo }> = ({ scene }) => {
  const baseW = 1280, baseH = 720;
  const scale = Math.min(PREVIEW_W / baseW, PREVIEW_H / baseH);
  const totalDuration = Math.max(scene.duration + 0.8, 2.5);
  const animName = useMemo(() => `scene-up-${Math.random().toString(36).slice(2, 8)}`, []);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), totalDuration * 1000);
    return () => clearInterval(id);
  }, [totalDuration]);

  return (
    <div
      className="relative rounded-lg overflow-hidden"
      style={{ width: PREVIEW_W, height: PREVIEW_H, background: scene.background ?? '#0f172a' }}
    >
      <style>{`
        @keyframes ${animName} {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div key={tick} style={{ position: 'absolute', inset: 0 }}>
        {scene.elements.map(el => {
          const w = el.width * scale;
          const h = el.height * scale;
          const left = el.x * PREVIEW_W - w / 2;
          const top  = el.y * PREVIEW_H - h / 2;
          const baseStyle: React.CSSProperties = {
            position: 'absolute',
            left, top, width: w, height: h,
            opacity: 0,
            animation: `${animName} ${el.animation.duration}s ease forwards ${el.animation.delay}s`,
          };
          if (el.type === 'text') {
            return (
              <div key={el.id} style={{
                ...baseStyle,
                color: el.color,
                fontSize: Math.max(7, (el.fontSize ?? 36) * scale * 1.5),
                fontWeight: el.fontWeight ?? 700,
                textAlign: el.align ?? 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center',
                lineHeight: 1,
                fontFamily: 'Inter, system-ui, sans-serif',
                letterSpacing: '-0.02em',
                whiteSpace: 'nowrap',
              }}>
                {el.content ?? el.id}
              </div>
            );
          }
          return (
            <div key={el.id} style={{
              ...baseStyle,
              background: el.color,
              borderRadius: el.borderRadius ? Math.max(2, el.borderRadius * scale) : 0,
            }} />
          );
        })}
      </div>
    </div>
  );
};

const CssAnimPreview: React.FC<{ spec: CssAnimSpec }> = ({ spec }) => {
  const animName = useMemo(() => `css-${spec.id}-${Math.random().toString(36).slice(2, 8)}`, [spec.id]);
  return (
    <div className="relative rounded-lg overflow-hidden flex items-center justify-center"
      style={{ width: PREVIEW_W, height: PREVIEW_H, background: '#0f172a' }}>
      <style>{`@keyframes ${animName} { ${spec.cssAnim} }`}</style>
      <div style={{
        width: 56, height: 56, borderRadius: 16, background: spec.color,
        animation: `${animName} ${spec.duration} ease-in-out infinite`,
      }} />
    </div>
  );
};

export const AnimationPortfolioModal: React.FC<AnimationPortfolioModalProps> = ({
  onAddLayers, onClose, compositionWidth, compositionHeight,
}) => {
  const [animations, setAnimations] = useState<ParsedAnimation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${KG_BASE}/getknowgraph?id=${ANIM_GRAPH}`)
      .then(r => r.json())
      .then(data => {
        const flat: ParsedAnimation[] = [];
        for (const n of data.nodes ?? []) flat.push(...parseNodeInfo(n));
        setAnimations(flat);
      })
      .catch(() => setError('Failed to load animations.'))
      .finally(() => setLoading(false));
  }, []);

  const handlePick = (anim: ParsedAnimation) => {
    if (anim.kind === 'scene') {
      onAddLayers(sceneToLayers(anim.scene, compositionWidth, compositionHeight));
    } else {
      onAddLayers([cssToLayer(anim.spec, compositionWidth, compositionHeight)]);
    }
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-5xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-white">Animation Portfolio</h2>
            <p className="text-xs text-slate-400 mt-1">Pick an animation — its scene will be added as one or more layers to your composition.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          {loading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}
          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {animations.map((anim, idx) => (
              <button
                key={`${anim.nodeId}-${idx}`}
                onClick={() => handlePick(anim)}
                className="flex flex-col items-stretch gap-2 p-3 rounded-xl border border-slate-700 hover:border-sky-500 bg-slate-800 hover:bg-slate-700 transition group text-left"
              >
                {anim.kind === 'scene'
                  ? <ScenePreview scene={anim.scene} />
                  : <CssAnimPreview spec={anim.spec} />}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-sm text-slate-300 group-hover:text-white font-medium truncate">
                    {anim.label}
                  </span>
                  <span className="text-xs text-slate-500">
                    {anim.kind === 'scene' ? `${anim.scene.elements.length} layers` : '1 layer'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
