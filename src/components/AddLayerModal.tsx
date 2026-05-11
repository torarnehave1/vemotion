import React, { useState, useEffect } from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
import type { Layer } from '../lib/api';

const KG_SHAPES_GRAPH = 'vemotion-shapes';
const KG_CARDS_GRAPH  = 'vemotion-cards';
const KG_BASE = 'https://knowledge.vegvisr.org';

interface KgShapeNode {
  id: string;
  label: string;
  color: string;
  info: string;
  metadata?: { viewBox?: string };
}

interface KgCardNode {
  id: string;
  label: string;
  color: string;
  metadata?: {
    backgroundColor?: string;
    padding?: number;
    titleFontSize?: number;
    titleColor?: string;
    titleFontWeight?: string;
    bodyFontSize?: number;
    bodyColor?: string;
    defaultWidth?: number;
    defaultHeight?: number;
  };
}

interface AddLayerModalProps {
  onAdd: (layer: Layer) => void;
  onClose: () => void;
  compositionDuration: number;
  compositionWidth: number;
  compositionHeight: number;
  editingLayer?: Layer;
}

type AnimationPreset =
  | 'none'
  | 'fade-in'
  | 'fade-out'
  | 'fade-in-out'
  | 'slide-left'
  | 'slide-right'
  | 'slide-top'
  | 'slide-bottom';

const PRESETS: { value: AnimationPreset; label: string }[] = [
  { value: 'none', label: 'No animation' },
  { value: 'fade-in', label: 'Fade in' },
  { value: 'fade-out', label: 'Fade out' },
  { value: 'fade-in-out', label: 'Fade in & out' },
  { value: 'slide-left', label: 'Slide in from left' },
  { value: 'slide-right', label: 'Slide in from right' },
  { value: 'slide-top', label: 'Slide in from top' },
  { value: 'slide-bottom', label: 'Slide in from bottom' },
];

function buildAnimation(
  preset: AnimationPreset,
  duration: number,
  width: number,
  height: number,
  layerWidth: number,
  layerHeight: number,
): Layer['animation'] | undefined {
  switch (preset) {
    case 'fade-in':
      return { property: 'opacity', keyframes: [{ time: 0, value: 0 }, { time: Math.min(1.5, duration), value: 1 }] };
    case 'fade-out':
      return { property: 'opacity', keyframes: [{ time: 0, value: 1 }, { time: duration, value: 0 }] };
    case 'fade-in-out':
      return { property: 'opacity', keyframes: [{ time: 0, value: 0 }, { time: Math.min(1, duration * 0.3), value: 1 }, { time: Math.max(duration - 1, duration * 0.7), value: 1 }, { time: duration, value: 0 }] };
    case 'slide-left':
      return { property: 'offsetX', keyframes: [{ time: 0, value: -(layerWidth + 100) }, { time: Math.min(1, duration * 0.4), value: 0 }] };
    case 'slide-right':
      return { property: 'offsetX', keyframes: [{ time: 0, value: width + 100 }, { time: Math.min(1, duration * 0.4), value: 0 }] };
    case 'slide-top':
      return { property: 'offsetY', keyframes: [{ time: 0, value: -(layerHeight + 100) }, { time: Math.min(1, duration * 0.4), value: 0 }] };
    case 'slide-bottom':
      return { property: 'offsetY', keyframes: [{ time: 0, value: height + 100 }, { time: Math.min(1, duration * 0.4), value: 0 }] };
    default:
      return undefined;
  }
}

function generateId() {
  return `layer-${Date.now().toString(36)}`;
}

export const AddLayerModal: React.FC<AddLayerModalProps> = ({
  onAdd, onClose, compositionDuration, compositionWidth, compositionHeight, editingLayer,
}) => {
  const isEditing = !!editingLayer;
  const isKgShape = editingLayer?.type === 'kg-shape';
  const isKgCard  = editingLayer?.type === 'card';
  const [tab, setTab] = useState<'manual' | 'ai' | 'shapes' | 'cards'>('manual');
  const [kgShapes, setKgShapes] = useState<KgShapeNode[]>([]);
  const [kgCards,  setKgCards]  = useState<KgCardNode[]>([]);
  const [kgLoading, setKgLoading] = useState(false);
  const [kgError, setKgError] = useState('');

  useEffect(() => {
    if (tab !== 'shapes' || kgShapes.length > 0) return;
    setKgLoading(true);
    fetch(`${KG_BASE}/getknowgraph?id=${KG_SHAPES_GRAPH}`)
      .then(r => r.json())
      .then(data => setKgShapes((data.nodes ?? []).filter((n: KgShapeNode) => n.info)))
      .catch(() => setKgError('Failed to load shapes from graph.'))
      .finally(() => setKgLoading(false));
  }, [tab]);

  useEffect(() => {
    if (tab !== 'cards' || kgCards.length > 0) return;
    setKgLoading(true);
    fetch(`${KG_BASE}/getknowgraph?id=${KG_CARDS_GRAPH}`)
      .then(r => r.json())
      .then(data => setKgCards(data.nodes ?? []))
      .catch(() => setKgError('Failed to load cards from graph.'))
      .finally(() => setKgLoading(false));
  }, [tab]);
  const [layerType, setLayerType] = useState<'text' | 'shape'>(
    (editingLayer?.type === 'text' || editingLayer?.type === 'shape') ? editingLayer.type : 'text'
  );
  const [text, setText] = useState((editingLayer?.properties.text as string) ?? 'Hello World');
  const [color, setColor] = useState((editingLayer?.properties.color as string) ?? '#ffffff');
  const [shape, setShape] = useState<'rect' | 'circle'>((editingLayer?.properties.shape as 'rect' | 'circle') ?? 'rect');
  const [fontSize, setFontSize] = useState((editingLayer?.properties.fontSize as number) ?? 48);
  const [width, setWidth] = useState(editingLayer?.size.width ?? 600);
  const [height, setHeight] = useState(editingLayer?.size.height ?? 80);
  const [posX, setPosX] = useState(editingLayer?.position.x ?? Math.floor((compositionWidth - 600) / 2));
  const [posY, setPosY] = useState(editingLayer?.position.y ?? Math.floor((compositionHeight - 80) / 2));
  const [preset, setPreset] = useState<AnimationPreset>('fade-in');
  const [shapePreset, setShapePreset] = useState<AnimationPreset>('fade-in');
  const [align, setAlign] = useState<'left' | 'center' | 'right'>((editingLayer?.properties.align as 'left' | 'center' | 'right') ?? 'center');
  const [kgColor, setKgColor] = useState((editingLayer?.properties.color as string) ?? '#ffffff');
  const [kgPosX, setKgPosX] = useState(editingLayer?.position.x ?? 0);
  const [kgPosY, setKgPosY] = useState(editingLayer?.position.y ?? 0);
  const [kgWidth, setKgWidth] = useState(editingLayer?.size.width ?? 200);
  const [kgHeight, setKgHeight] = useState(editingLayer?.size.height ?? 200);
  const [kgPreset, setKgPreset] = useState<AnimationPreset>('fade-in');

  // Card edit state
  const [cardTitle,    setCardTitle]    = useState((editingLayer?.properties.title as string) ?? 'Title');
  const [cardBody,     setCardBody]     = useState((editingLayer?.properties.body as string) ?? '');
  const [cardPosX,     setCardPosX]     = useState(editingLayer?.position.x ?? 0);
  const [cardPosY,     setCardPosY]     = useState(editingLayer?.position.y ?? 0);
  const [cardWidth,    setCardWidth]    = useState(editingLayer?.size.width ?? 470);
  const [cardHeight,   setCardHeight]   = useState(editingLayer?.size.height ?? 250);
  const [cardPreset,   setCardPreset]   = useState<AnimationPreset>('fade-in');
  const [cardPickPreset, setCardPickPreset] = useState<AnimationPreset>('fade-in');

  // AI prompt
  const [prompt, setPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const handleSaveKgShape = () => {
    if (!editingLayer || !isKgShape) return;
    const animation = buildAnimation(kgPreset, compositionDuration, compositionWidth, compositionHeight, kgWidth, kgHeight);
    onAdd({
      ...editingLayer,
      position: { x: kgPosX, y: kgPosY },
      size: { width: kgWidth, height: kgHeight },
      animation,
      properties: { ...editingLayer.properties, color: kgColor },
    });
    onClose();
  };

  const handleSaveCard = () => {
    if (!editingLayer || !isKgCard) return;
    const animation = buildAnimation(cardPreset, compositionDuration, compositionWidth, compositionHeight, cardWidth, cardHeight);
    onAdd({
      ...editingLayer,
      position: { x: cardPosX, y: cardPosY },
      size: { width: cardWidth, height: cardHeight },
      animation,
      properties: { ...editingLayer.properties, title: cardTitle, body: cardBody },
    });
    onClose();
  };

  const handleAdd = () => {
    const animation = isEditing
      ? editingLayer.animation
      : buildAnimation(preset, compositionDuration, compositionWidth, compositionHeight, width, height);

    const layer: Layer = {
      id: isEditing ? editingLayer.id : generateId(),
      type: layerType,
      position: { x: posX, y: posY },
      size: { width, height },
      startTime: isEditing ? editingLayer.startTime : undefined,
      layerDuration: isEditing ? editingLayer.layerDuration : undefined,
      animation,
      properties: layerType === 'text'
        ? { text, fontSize, color, align, fontWeight: '600' }
        : { shape, color },
    };

    onAdd(layer);
    onClose();
  };

  const handleAiGenerate = async () => {
    if (!prompt.trim()) return;
    setAiLoading(true);
    setAiError('');

    try {
      const res = await fetch('/api/video/generate-layer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          compositionWidth,
          compositionHeight,
          compositionDuration,
        }),
      });

      if (!res.ok) throw new Error('AI generation failed');

      const data = await res.json();
      onAdd({ ...data.layer, id: generateId() });
      onClose();
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to generate layer');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">{isEditing ? `Edit layer — ${editingLayer.id}` : 'Add Layer'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs — hidden when editing an existing layer */}
        {!isEditing && (
          <div className="flex border-b border-slate-800">
            <button
              onClick={() => setTab('manual')}
              className={`flex-1 py-3 text-sm font-medium transition ${tab === 'manual' ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-400 hover:text-white'}`}
            >
              Manual
            </button>
            <button
              onClick={() => setTab('shapes')}
              className={`flex-1 py-3 text-sm font-medium transition ${tab === 'shapes' ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-400 hover:text-white'}`}
            >
              Shapes
            </button>
            <button
              onClick={() => setTab('cards')}
              className={`flex-1 py-3 text-sm font-medium transition ${tab === 'cards' ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-400 hover:text-white'}`}
            >
              Cards
            </button>
            <button
              onClick={() => setTab('ai')}
              className={`flex-1 py-3 text-sm font-medium transition flex items-center justify-center gap-1 ${tab === 'ai' ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-400 hover:text-white'}`}
            >
              <Sparkles className="w-4 h-4" /> AI
            </button>
          </div>
        )}

        <div className="p-6 space-y-4">
          {isKgCard ? (
            <>
              <div className="flex justify-center py-2">
                <div className="rounded-xl px-4 py-3 text-center w-48"
                  style={{ backgroundColor: (editingLayer.properties.backgroundColor as string) ?? '#1e293b' }}>
                  <p className="font-bold text-sm truncate" style={{ color: (editingLayer.properties.titleColor as string) ?? '#fff' }}>{cardTitle || 'Title'}</p>
                  <p className="text-xs mt-1 opacity-80 line-clamp-2" style={{ color: (editingLayer.properties.bodyColor as string) ?? '#cbd5e1' }}>{cardBody || 'Body text'}</p>
                </div>
              </div>
              <div><label className="text-xs text-slate-400 mb-1 block">Title</label>
                <input value={cardTitle} onChange={e => setCardTitle(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
              <div><label className="text-xs text-slate-400 mb-1 block">Body</label>
                <textarea value={cardBody} onChange={e => setCardBody(e.target.value)} rows={3}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-slate-400 mb-1 block">Position X</label>
                  <input type="number" value={cardPosX} onChange={e => setCardPosX(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div><label className="text-xs text-slate-400 mb-1 block">Position Y</label>
                  <input type="number" value={cardPosY} onChange={e => setCardPosY(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div><label className="text-xs text-slate-400 mb-1 block">Width</label>
                  <input type="number" value={cardWidth} onChange={e => setCardWidth(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div><label className="text-xs text-slate-400 mb-1 block">Height</label>
                  <input type="number" value={cardHeight} onChange={e => setCardHeight(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
              </div>
              <div><label className="text-xs text-slate-400 mb-1 block">Animation</label>
                <select value={cardPreset} onChange={e => setCardPreset(e.target.value as AnimationPreset)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                  {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <button onClick={handleSaveCard}
                className="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg py-3 transition">
                Save Changes
              </button>
            </>
          ) : isKgShape ? (
            <>
              <div className="flex justify-center py-2">
                <svg viewBox={(editingLayer.properties.viewBox as string) ?? '0 0 24 24'} className="w-16 h-16">
                  <path d={editingLayer.properties.svgPath as string} fill={kgColor} />
                </svg>
              </div>
              <label className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Color</span>
                <div className="flex items-center gap-2">
                  <input type="color" value={kgColor} onChange={e => setKgColor(e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer border border-slate-600 bg-transparent" />
                  <input value={kgColor} onChange={e => setKgColor(e.target.value)}
                    className="w-28 bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-slate-400 mb-1 block">Position X</label>
                  <input type="number" value={kgPosX} onChange={e => setKgPosX(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div><label className="text-xs text-slate-400 mb-1 block">Position Y</label>
                  <input type="number" value={kgPosY} onChange={e => setKgPosY(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div><label className="text-xs text-slate-400 mb-1 block">Width</label>
                  <input type="number" value={kgWidth} onChange={e => setKgWidth(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div><label className="text-xs text-slate-400 mb-1 block">Height</label>
                  <input type="number" value={kgHeight} onChange={e => setKgHeight(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
              </div>
              <div><label className="text-xs text-slate-400 mb-1 block">Animation</label>
                <select value={kgPreset} onChange={e => setKgPreset(e.target.value as AnimationPreset)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                  {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <button onClick={handleSaveKgShape}
                className="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg py-3 transition">
                Save Changes
              </button>
            </>
          ) : tab === 'shapes' ? (
            <>
              <p className="text-xs text-slate-400">Pick a shape from the <span className="text-sky-400">vemotion-shapes</span> graph. It will be snapshotted into your composition.</p>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Animation</label>
                <select value={shapePreset} onChange={e => setShapePreset(e.target.value as AnimationPreset)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                  {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              {kgLoading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}
              {kgError && <p className="text-red-400 text-sm">{kgError}</p>}
              <div className="grid grid-cols-3 gap-3">
                {kgShapes.map(shape => (
                  <button
                    key={shape.id}
                    className="flex flex-col items-center gap-2 p-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-sky-500 rounded-xl transition group"
                    onClick={() => {
                      const viewBox = shape.metadata?.viewBox ?? '0 0 24 24';
                      const animation = buildAnimation(shapePreset, compositionDuration, compositionWidth, compositionHeight, 200, 200);
                      const layer: Layer = {
                        id: generateId(),
                        type: 'kg-shape',
                        position: { x: Math.floor((compositionWidth - 200) / 2), y: Math.floor((compositionHeight - 200) / 2) },
                        size: { width: 200, height: 200 },
                        animation,
                        properties: {
                          svgPath: shape.info,
                          viewBox,
                          color: shape.color,
                          filled: true,
                          kgNodeId: shape.id,
                          kgGraphId: KG_SHAPES_GRAPH,
                        },
                      };
                      onAdd(layer);
                      onClose();
                    }}
                  >
                    <svg viewBox={shape.metadata?.viewBox ?? '0 0 24 24'} className="w-10 h-10" fill="none" stroke={shape.color} strokeWidth="1.5">
                      <path d={shape.info} fill={shape.color} stroke="none" />
                    </svg>
                    <span className="text-xs text-slate-400 group-hover:text-white truncate w-full text-center">{shape.label}</span>
                  </button>
                ))}
              </div>
            </>
          ) : tab === 'cards' ? (
            <>
              <p className="text-xs text-slate-400">Pick a card template from the <span className="text-sky-400">vemotion-cards</span> graph. Title and body text are editable after adding.</p>
              <div><label className="text-xs text-slate-400 mb-1 block">Animation</label>
                <select value={cardPickPreset} onChange={e => setCardPickPreset(e.target.value as AnimationPreset)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                  {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              {kgLoading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}
              {kgError && <p className="text-red-400 text-sm">{kgError}</p>}
              <div className="grid grid-cols-2 gap-3">
                {kgCards.map(card => {
                  const bg = card.metadata?.backgroundColor ?? '#1e293b';
                  const tc = card.metadata?.titleColor ?? '#ffffff';
                  const bc = card.metadata?.bodyColor ?? '#94a3b8';
                  const dw = card.metadata?.defaultWidth ?? 470;
                  const dh = card.metadata?.defaultHeight ?? 250;
                  return (
                    <button
                      key={card.id}
                      className="flex flex-col items-start gap-1 p-3 rounded-xl border border-slate-700 hover:border-sky-500 transition group"
                      style={{ backgroundColor: bg }}
                      onClick={() => {
                        const animation = buildAnimation(cardPickPreset, compositionDuration, compositionWidth, compositionHeight, dw, dh);
                        const layer: Layer = {
                          id: generateId(),
                          type: 'card',
                          position: { x: Math.floor((compositionWidth - dw) / 2), y: Math.floor((compositionHeight - dh) / 2) },
                          size: { width: dw, height: dh },
                          animation,
                          properties: {
                            ...card.metadata,
                            title: 'Card Title',
                            body: 'Edit this text to describe your content here.',
                            kgNodeId: card.id,
                            kgGraphId: KG_CARDS_GRAPH,
                          },
                        };
                        onAdd(layer);
                        onClose();
                      }}
                    >
                      <p className="text-sm font-bold truncate w-full" style={{ color: tc }}>{card.label}</p>
                      <p className="text-xs opacity-70 w-full text-left" style={{ color: bc }}>{dw} × {dh}</p>
                    </button>
                  );
                })}
              </div>
            </>
          ) : tab === 'manual' ? (
            <>
              {/* Layer type */}
              <div className="flex gap-2">
                {(['text', 'shape'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setLayerType(t)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition ${layerType === t ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Layer-specific props */}
              {layerType === 'text' ? (
                <>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Text</label>
                    <input
                      value={text}
                      onChange={e => setText(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Font Size</label>
                      <input type="number" value={fontSize} onChange={e => setFontSize(parseInt(e.target.value))}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Align</label>
                      <select value={align} onChange={e => setAlign(e.target.value as 'left' | 'center' | 'right')}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Shape</label>
                  <div className="flex gap-2">
                    {(['rect', 'circle'] as const).map(s => (
                      <button key={s} onClick={() => setShape(s)}
                        className={`flex-1 py-2 rounded-lg text-sm capitalize transition ${shape === s ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Color */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Color</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={color} onChange={e => setColor(e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer border-0 bg-transparent" />
                  <input value={color} onChange={e => setColor(e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
              </div>

              {/* Position & Size */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Position X</label>
                  <input type="number" value={posX} onChange={e => setPosX(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Position Y</label>
                  <input type="number" value={posY} onChange={e => setPosY(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Width</label>
                  <input type="number" value={width} onChange={e => setWidth(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Height</label>
                  <input type="number" value={height} onChange={e => setHeight(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
              </div>

              {/* Animation preset */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Animation</label>
                <select value={preset} onChange={e => setPreset(e.target.value as AnimationPreset)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                  {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>

              <button onClick={handleAdd}
                className="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg py-3 transition">
                {isEditing ? 'Save Changes' : 'Add Layer'}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-400">Describe the layer you want to add and AI will generate it for you.</p>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={4}
                placeholder="e.g. A red rectangle that slides in from the left and fades out at the end"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
              />
              {aiError && (
                <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{aiError}</p>
              )}
              <button onClick={handleAiGenerate} disabled={aiLoading || !prompt.trim()}
                className="w-full bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg py-3 transition flex items-center justify-center gap-2">
                {aiLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Sparkles className="w-4 h-4" /> Generate with AI</>}
              </button>
              <p className="text-xs text-slate-500 text-center">AI endpoint requires worker to be configured</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
