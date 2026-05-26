import React, { useState, useEffect, useRef } from 'react';
import { AudioLayerForm } from './AudioLayerForm';
import { createPortal } from 'react-dom';
import { X, Sparkles, Loader2, Upload } from 'lucide-react';
import type { Layer, MotionScene } from '../lib/api';
import { readStoredUser } from '../lib/auth';

const KG_SHAPES_GRAPH = 'vemotion-shapes';
const KG_CARDS_GRAPH  = 'vemotion-cards';
const KG_BASE = 'https://knowledge.vegvisr.org';
const PHOTOS_API = 'https://photos-api.vegvisr.org';
const DEFAULT_ALBUM = 'VEmotion';

const FONT_OPTIONS = [
  { label: 'Composition default', value: '' },
  { label: 'Inter',               value: 'Inter' },
  { label: 'Poppins',             value: 'Poppins' },
  { label: 'Caveat (hand-drawn)', value: 'Caveat' },
  { label: 'Montserrat',          value: 'Montserrat' },
  { label: 'DM Sans',             value: 'DM Sans' },
  { label: 'Plus Jakarta Sans',   value: 'Plus Jakarta Sans' },
  { label: 'Space Grotesk',       value: 'Space Grotesk' },
];

const MATH_SHAPE_PRESETS = {
  circle: {
    label: 'Circle',
    samples: 180,
    tStart: 0,
    tEnd: Math.PI * 2,
    xFormula: 'x0 + w/2 + min(w,h)*0.35*cos(t)',
    yFormula: 'y0 + h/2 + min(w,h)*0.35*sin(t)',
    closePath: true,
  },
  ellipse: {
    label: 'Ellipse',
    samples: 180,
    tStart: 0,
    tEnd: Math.PI * 2,
    xFormula: 'x0 + w/2 + w*0.35*cos(t)',
    yFormula: 'y0 + h/2 + h*0.22*sin(t)',
    closePath: true,
  },
  sine: {
    label: 'Sine wave',
    samples: 220,
    tStart: 0,
    tEnd: 1,
    xFormula: 'x0 + p*w',
    yFormula: 'y0 + h/2 + sin(p*pi*4)*h*0.25',
    closePath: false,
  },
  spiral: {
    label: 'Spiral',
    samples: 240,
    tStart: 0,
    tEnd: Math.PI * 6,
    xFormula: 'x0 + w/2 + (t/(pi*6))*min(w,h)*0.4*cos(t)',
    yFormula: 'y0 + h/2 + (t/(pi*6))*min(w,h)*0.4*sin(t)',
    closePath: false,
  },
} as const;

type MathShapePresetKey = keyof typeof MATH_SHAPE_PRESETS;

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

interface AlbumImage {
  key: string;
  url: string;
  name?: string;
  displayName?: string;
  tags?: string[];
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
  | 'slide-bottom'
  | 'bounce'
  | 'scale-up'
  | 'staggered-reveal'
  | 'type-on'
  | 'wipe-from-left'
  | 'wipe-from-right'
  | 'wipe-from-top'
  | 'wipe-from-bottom'
  | 'iris-reveal';

interface KgAnimNode {
  id: string;
  label: string;
  color: string;
  info?: string;
}

const PRESETS: { value: AnimationPreset; label: string }[] = [
  { value: 'none', label: 'No animation' },
  { value: 'fade-in', label: 'Fade in' },
  { value: 'fade-out', label: 'Fade out' },
  { value: 'fade-in-out', label: 'Fade in & out' },
  { value: 'slide-left', label: 'Slide in from left' },
  { value: 'slide-right', label: 'Slide in from right' },
  { value: 'slide-top', label: 'Slide in from top' },
  { value: 'slide-bottom', label: 'Slide in from bottom' },
  { value: 'wipe-from-left', label: 'Wipe in from left' },
  { value: 'wipe-from-right', label: 'Wipe in from right' },
  { value: 'wipe-from-top', label: 'Wipe in from top' },
  { value: 'wipe-from-bottom', label: 'Wipe in from bottom' },
  { value: 'iris-reveal', label: 'Iris reveal (radial)' },
];

// Text-only presets. The per-char (char-stagger) effects only make sense on
// text layers — they're silently dropped by the renderer on other layer types,
// so we keep them out of the universal PRESETS list and only show them in the
// text-layer dropdown.
const TEXT_PRESETS: { value: AnimationPreset; label: string }[] = [
  ...PRESETS,
  { value: 'type-on', label: 'Type-on (per character)' },
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
    case 'bounce': {
      const t = Math.min(1.2, duration);
      return { property: 'offsetY', keyframes: [{ time: 0, value: -(layerHeight + 60) }, { time: t * 0.5, value: 10 }, { time: t * 0.7, value: -20 }, { time: t * 0.85, value: 5 }, { time: t, value: 0 }] };
    }
    case 'scale-up':
      return { property: 'scale', keyframes: [{ time: 0, value: 0.05 }, { time: Math.min(1, duration * 0.4), value: 1 }] };
    case 'staggered-reveal':
      return { property: 'opacity', keyframes: [{ time: 0, value: 0 }, { time: 0.2, value: 0 }, { time: 0.8, value: 1 }, { time: Math.min(2.1, duration), value: 1 }] };
    case 'type-on':
      // Per-character reveal: each glyph fades in over 150ms with a 50ms
      // delay between successive characters. The renderer multiplies the
      // delay by the glyph index. Wired only for text layers in the UI.
      return {
        kind: 'char-stagger',
        property: 'opacity',
        stagger: 0.05,
        keyframes: [{ time: 0, value: 0 }, { time: 0.15, value: 1 }],
      };
    // Mask-wipe family: animated clip path on the whole layer. Five directions
    // share the same kind + keyframe shape; only `direction` differs. The
    // wipe completes in ~min(1.2s, 40% of layer duration) — long enough to
    // read as a deliberate reveal, short enough not to feel sluggish.
    case 'wipe-from-left':
      return {
        kind: 'mask-wipe',
        direction: 'ltr',
        keyframes: [{ time: 0, value: 0 }, { time: Math.min(1.2, duration * 0.4), value: 1 }],
      };
    case 'wipe-from-right':
      return {
        kind: 'mask-wipe',
        direction: 'rtl',
        keyframes: [{ time: 0, value: 0 }, { time: Math.min(1.2, duration * 0.4), value: 1 }],
      };
    case 'wipe-from-top':
      return {
        kind: 'mask-wipe',
        direction: 'ttb',
        keyframes: [{ time: 0, value: 0 }, { time: Math.min(1.2, duration * 0.4), value: 1 }],
      };
    case 'wipe-from-bottom':
      return {
        kind: 'mask-wipe',
        direction: 'btt',
        keyframes: [{ time: 0, value: 0 }, { time: Math.min(1.2, duration * 0.4), value: 1 }],
      };
    case 'iris-reveal':
      return {
        kind: 'mask-wipe',
        direction: 'radial',
        keyframes: [{ time: 0, value: 0 }, { time: Math.min(1.2, duration * 0.4), value: 1 }],
      };
    default:
      return undefined;
  }
}

function generateId() {
  return `layer-${Date.now().toString(36)}`;
}

function detectPresetFromAnimation(animation: Layer['animation'] | undefined): AnimationPreset {
  if (!animation) return 'none';
  if (animation.kind === 'char-stagger' && animation.property === 'opacity') return 'type-on';
  if (animation.kind === 'mask-wipe') {
    switch (animation.direction) {
      case 'ltr':    return 'wipe-from-left';
      case 'rtl':    return 'wipe-from-right';
      case 'ttb':    return 'wipe-from-top';
      case 'btt':    return 'wipe-from-bottom';
      case 'radial': return 'iris-reveal';
      default:       return 'wipe-from-left';
    }
  }
  if (!animation.property) return 'none';
  switch (animation.property) {
    case 'opacity': {
      const frames = animation.keyframes;
      if (frames.length >= 4) return 'fade-in-out';
      const first = Number(frames[0]?.value ?? 0);
      const last = Number(frames[frames.length - 1]?.value ?? 1);
      if (first === 0 && last === 1) return 'fade-in';
      if (first === 1 && last === 0) return 'fade-out';
      return 'none';
    }
    case 'offsetX': {
      const first = Number(animation.keyframes[0]?.value ?? 0);
      return first < 0 ? 'slide-left' : 'slide-right';
    }
    case 'offsetY': {
      const frames = animation.keyframes;
      if (frames.length >= 5) return 'bounce';
      const first = Number(frames[0]?.value ?? 0);
      return first < 0 ? 'slide-top' : 'slide-bottom';
    }
    case 'scale':
      return 'scale-up';
    default:
      return 'none';
  }
}

function formatMotionScenes(scenes: unknown): string {
  if (!Array.isArray(scenes) || scenes.length === 0) return '';
  try {
    return JSON.stringify(scenes, null, 2);
  } catch {
    return '';
  }
}

function parseMotionScenes(json: string): MotionScene[] | undefined {
  const trimmed = json.trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error('Motion scenes must be a JSON array.');
  }
  return parsed.map((scene, index) => {
    if (!scene || typeof scene !== 'object') {
      throw new Error(`Scene ${index + 1} must be an object.`);
    }
    const sceneObj = scene as Record<string, unknown>;
    const start = Number(sceneObj.start);
    const end = Number(sceneObj.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      throw new Error(`Scene ${index + 1} must have valid start/end values.`);
    }
    // Preserve any optional fields the editor doesn't know about
    // (scaleFormula, future additions) by spreading the source object first,
    // then overriding the validated numeric start/end. Saves the editor from
    // silently stripping unknown fields when an agent or the JSON editor
    // authors a richer MotionScene than this form has UI for.
    return {
      ...sceneObj,
      start,
      end,
    } as MotionScene;
  });
}

export const AddLayerModal: React.FC<AddLayerModalProps> = ({
  onAdd, onClose, compositionDuration, compositionWidth, compositionHeight, editingLayer,
}) => {
  const isEditing  = !!editingLayer;
  const isKgShape  = editingLayer?.type === 'kg-shape';
  const isKgCard   = editingLayer?.type === 'card';
  const isImgLayer = editingLayer?.type === 'image';
  const [tab, setTab] = useState<'manual' | 'ai' | 'shapes' | 'cards' | 'images' | 'animations' | 'audio'>('manual');
  const [kgShapes, setKgShapes] = useState<KgShapeNode[]>([]);
  const [kgCards,  setKgCards]  = useState<KgCardNode[]>([]);
  const [kgAnims,  setKgAnims]  = useState<KgAnimNode[]>([]);
  const [kgLoading, setKgLoading] = useState(false);
  const [kgError, setKgError] = useState('');
  const anyAnimPickerOpen = tab === 'animations';

  useEffect(() => {
    if (!anyAnimPickerOpen || kgAnims.length > 0) return;
    fetch(`${KG_BASE}/getknowgraph?id=vemotion-animations`)
      .then(r => r.json())
      .then(data => {
        const nodes: KgAnimNode[] = (data.nodes ?? []).map((n: KgAnimNode) => ({
          id: n.id,
          label: n.label,
          color: n.color,
          info: n.info,
        }));
        setKgAnims(nodes);
      })
      .catch(() => {});
  }, [anyAnimPickerOpen]);

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
  const [layerType, setLayerType] = useState<'text' | 'shape' | 'math-shape'>(
    (editingLayer?.type === 'text' || editingLayer?.type === 'shape' || editingLayer?.type === 'math-shape') ? editingLayer.type : 'text'
  );
  const [text, setText] = useState((editingLayer?.properties.text as string) ?? 'Hello World');
  const [color, setColor] = useState((editingLayer?.properties.color as string) ?? '#ffffff');
  const [shape, setShape] = useState<'rect' | 'circle'>((editingLayer?.properties.shape as 'rect' | 'circle') ?? 'rect');
  const [mathKind] = useState<'parametric'>('parametric');
  const [mathPreset, setMathPreset] = useState<MathShapePresetKey>('circle');
  const [samples, setSamples] = useState(Number(editingLayer?.properties.samples) || 180);
  const [strokeWidth, setStrokeWidth] = useState(Number(editingLayer?.properties.strokeWidth) || 3);
  const [tStart, setTStart] = useState(Number(editingLayer?.properties.tStart) || 0);
  const [tEnd, setTEnd] = useState(Number(editingLayer?.properties.tEnd) || Math.PI * 2);
  const [xFormula, setXFormula] = useState((editingLayer?.properties.xFormula as string) ?? 'x0 + w/2 + min(w,h)*0.35*cos(t)');
  const [yFormula, setYFormula] = useState((editingLayer?.properties.yFormula as string) ?? 'y0 + h/2 + min(w,h)*0.35*sin(t)');
  const [closePath, setClosePath] = useState(editingLayer?.properties.closePath !== false);
  const [fillColor, setFillColor] = useState(
    typeof editingLayer?.properties.fill === 'string' ? (editingLayer.properties.fill as string) : ''
  );
  const [drawOverTime, setDrawOverTime] = useState(() => editingLayer?.animation?.property === 'drawProgress');
  const [drawStartTime, setDrawStartTime] = useState(() => editingLayer?.animation?.property === 'drawProgress' ? editingLayer.animation.keyframes[0]?.time ?? 0 : 0);
  const [drawEndTime, setDrawEndTime] = useState(() => editingLayer?.animation?.property === 'drawProgress' ? editingLayer.animation.keyframes[editingLayer.animation.keyframes.length - 1]?.time ?? Math.min(3, compositionDuration) : Math.min(3, compositionDuration));
  const [fontSize, setFontSize] = useState((editingLayer?.properties.fontSize as number) ?? 48);
  const [width, setWidth] = useState(editingLayer?.size.width ?? 600);
  const [height, setHeight] = useState(editingLayer?.size.height ?? 80);
  const [posX, setPosX] = useState(editingLayer?.position.x ?? Math.floor((compositionWidth - 600) / 2));
  const [posY, setPosY] = useState(editingLayer?.position.y ?? Math.floor((compositionHeight - 80) / 2));
  const [opacityValue, setOpacityValue] = useState(() => {
    const raw = editingLayer?.properties.opacity;
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 1;
  });
  const [preset, setPreset] = useState<AnimationPreset>(() => detectPresetFromAnimation(editingLayer?.animation) || 'fade-in');
  const [shapePreset, setShapePreset] = useState<AnimationPreset>('fade-in');
  const [align, setAlign] = useState<'left' | 'center' | 'right'>((editingLayer?.properties.align as 'left' | 'center' | 'right') ?? 'center');
  const [kgColor, setKgColor] = useState((editingLayer?.properties.color as string) ?? '#ffffff');
  const [kgPosX, setKgPosX] = useState(editingLayer?.position.x ?? 0);
  const [kgPosY, setKgPosY] = useState(editingLayer?.position.y ?? 0);
  const [kgWidth, setKgWidth] = useState(editingLayer?.size.width ?? 200);
  const [kgHeight, setKgHeight] = useState(editingLayer?.size.height ?? 200);
  const [kgPreset, setKgPreset] = useState<AnimationPreset>('fade-in');

  // Image layer edit state
  const [imgPosX,   setImgPosX]   = useState(editingLayer?.position.x ?? 0);
  const [imgPosY,   setImgPosY]   = useState(editingLayer?.position.y ?? 0);
  const [imgWidth,  setImgWidth]  = useState(editingLayer?.size.width ?? 400);
  const [imgHeight, setImgHeight] = useState(editingLayer?.size.height ?? 400);
  const [imgFit,    setImgFit]    = useState((editingLayer?.properties.fit as string) ?? 'cover');

  // Animation — canvas coordinate based
  const _ea = isImgLayer ? editingLayer?.animation : undefined;
  const _px = editingLayer?.position.x ?? 0;
  const _py = editingLayer?.position.y ?? 0;

  type ImgAnimType = 'none' | 'fade-in' | 'fade-out' | 'fade-in-out' | 'slide' | 'bounce' | 'scale-up' | string;
  const _detectType = (anim: Layer['animation']): ImgAnimType => {
    if (!anim) return 'none';
    if (anim.property === 'offsetX' || anim.property === 'offsetY') return 'slide';
    if (anim.property === 'opacity') {
      if (anim.keyframes.length >= 3) return 'fade-in-out';
      return (anim.keyframes[0].value as number) === 0 ? 'fade-in' : 'fade-out';
    }
    return 'none';
  };

  const [imgAnimType, setImgAnimType] = useState<ImgAnimType>(() => _detectType(_ea));
  const [animStartX, setAnimStartX] = useState(() =>
    _ea?.property === 'offsetX' ? _px + (_ea.keyframes[0].value as number) : _px
  );
  const [animStartY, setAnimStartY] = useState(() =>
    _ea?.property === 'offsetY' ? _py + (_ea.keyframes[0].value as number) : _py
  );
  const [animEndX, setAnimEndX] = useState(() =>
    _ea?.property === 'offsetX' ? _px + (_ea.keyframes[_ea.keyframes.length - 1].value as number) : _px
  );
  const [animEndY, setAnimEndY] = useState(() =>
    _ea?.property === 'offsetY' ? _py + (_ea.keyframes[_ea.keyframes.length - 1].value as number) : _py
  );
  const [animStartTime, setAnimStartTime] = useState(() => _ea?.keyframes[0].time ?? 0);
  const [animEndTime,   setAnimEndTime]   = useState(() =>
    _ea ? _ea.keyframes[_ea.keyframes.length - 1].time : Math.min(2, compositionDuration)
  );

  const handleSaveImage = () => {
    if (!editingLayer || !isImgLayer) return;
    let motionScenes: MotionScene[] | undefined;
    try {
      motionScenes = parseMotionScenes(motionScenesJson);
      setMotionScenesError('');
    } catch (error) {
      setMotionScenesError(error instanceof Error ? error.message : 'Invalid motion scenes JSON.');
      return;
    }
    let animation: Layer['animation'] = undefined;
    let extraAnimations: Layer['animations'] = undefined;
    const st = animStartTime;
    const et = animEndTime;
    if (imgAnimType === 'fade-in') {
      animation = { property: 'opacity', keyframes: [{ time: st, value: 0 }, { time: et, value: 1 }] };
    } else if (imgAnimType === 'fade-out') {
      animation = { property: 'opacity', keyframes: [{ time: st, value: 1 }, { time: et, value: 0 }] };
    } else if (imgAnimType === 'fade-in-out') {
      const m1 = st + (et - st) * 0.2;
      const m2 = st + (et - st) * 0.8;
      animation = { property: 'opacity', keyframes: [{ time: st, value: 0 }, { time: m1, value: 1 }, { time: m2, value: 1 }, { time: et, value: 0 }] };
    } else if (imgAnimType === 'bounce' || imgAnimType === 'scale-up' || (imgAnimType !== 'none' && imgAnimType !== 'fade-in' && imgAnimType !== 'fade-out' && imgAnimType !== 'fade-in-out' && imgAnimType !== 'slide')) {
      animation = buildAnimation(imgAnimType as AnimationPreset, compositionDuration, compositionWidth, compositionHeight, imgWidth, imgHeight);
    } else if (imgAnimType === 'slide') {
      const dX = Math.abs(animEndX - animStartX);
      const dY = Math.abs(animEndY - animStartY);
      if (dX > 0 && dY > 0) {
        // diagonal — animate both axes
        animation = { property: 'offsetX', keyframes: [{ time: st, value: animStartX - imgPosX }, { time: et, value: animEndX - imgPosX }] };
        extraAnimations = [{ property: 'offsetY', keyframes: [{ time: st, value: animStartY - imgPosY }, { time: et, value: animEndY - imgPosY }] }];
      } else if (dX > 0) {
        animation = { property: 'offsetX', keyframes: [{ time: st, value: animStartX - imgPosX }, { time: et, value: animEndX - imgPosX }] };
      } else {
        animation = { property: 'offsetY', keyframes: [{ time: st, value: animStartY - imgPosY }, { time: et, value: animEndY - imgPosY }] };
      }
    }
    onAdd({
      ...editingLayer,
      position: { x: imgPosX, y: imgPosY },
      size: { width: imgWidth, height: imgHeight },
      animation,
      animations: extraAnimations,
      properties: {
        ...editingLayer.properties,
        fit: imgFit,
        opacity: opacityValue,
        ...(motionScenes ? { motionScenes } : { motionScenes: undefined }),
      },
    });
    onClose();
  };

  // Font override
  const [fontFamily, setFontFamily] = useState((editingLayer?.properties.fontFamily as string) ?? '');
  const [cardFontFamily, setCardFontFamily] = useState((editingLayer?.properties.fontFamily as string) ?? '');
  const [motionScenesJson, setMotionScenesJson] = useState(formatMotionScenes(editingLayer?.properties.motionScenes));
  const [motionScenesError, setMotionScenesError] = useState('');
  // Text fill mode (slice 3 — text-as-mask). Default 'solid' = unchanged behaviour.
  // When 'image', the letter shapes mask the source image via offscreen canvas
  // + globalCompositeOperation='source-in' in the renderer.
  const [fillMode, setFillMode] = useState<'solid' | 'image'>(
    (editingLayer?.properties.fillMode === 'image' ? 'image' : 'solid')
  );
  const [fillSource, setFillSource] = useState((editingLayer?.properties.fillSource as string) ?? '');

  // Card edit state
  const [cardTitle,    setCardTitle]    = useState((editingLayer?.properties.title as string) ?? 'Title');
  const [cardBody,     setCardBody]     = useState((editingLayer?.properties.body as string) ?? '');
  const [cardPosX,     setCardPosX]     = useState(editingLayer?.position.x ?? 0);
  const [cardPosY,     setCardPosY]     = useState(editingLayer?.position.y ?? 0);
  const [cardWidth,    setCardWidth]    = useState(editingLayer?.size.width ?? 470);
  const [cardHeight,   setCardHeight]   = useState(editingLayer?.size.height ?? 250);
  const [cardPreset,   setCardPreset]   = useState<AnimationPreset>('fade-in');
  const [cardPickPreset, setCardPickPreset] = useState<AnimationPreset>('fade-in');

  const applyMathShapePreset = (presetKey: MathShapePresetKey) => {
    const preset = MATH_SHAPE_PRESETS[presetKey];
    setMathPreset(presetKey);
    setSamples(preset.samples);
    setTStart(preset.tStart);
    setTEnd(preset.tEnd);
    setXFormula(preset.xFormula);
    setYFormula(preset.yFormula);
    setClosePath(preset.closePath);
  };

  // Image assets
  const [albumName, setAlbumName] = useState(DEFAULT_ALBUM);
  const [albumImages, setAlbumImages] = useState<AlbumImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesError, setImagesError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tab !== 'images') return;
    fetchAlbum(albumName);
  }, [tab]);

  const fetchAlbum = (name: string) => {
    const token = readStoredUser()?.emailVerificationToken;
    if (!token) { setImagesError('Not authenticated'); return; }
    setImagesLoading(true);
    setImagesError('');
    fetch(`${PHOTOS_API}/list-r2-images?album=${encodeURIComponent(name)}`, {
      headers: { 'X-API-Token': token },
    })
      .then(r => r.json())
      .then(data => setAlbumImages(data.images ?? []))
      .catch(() => setImagesError('Failed to load album.'))
      .finally(() => setImagesLoading(false));
  };

  const handleImagePick = (img: AlbumImage) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => {
      // Clamp to canvas, preserve aspect ratio
      let w = el.naturalWidth || 400;
      let h = el.naturalHeight || 400;
      const scaleW = w > compositionWidth  ? compositionWidth  / w : 1;
      const scaleH = h > compositionHeight ? compositionHeight / h : 1;
      const scale  = Math.min(scaleW, scaleH);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const x = Math.round((compositionWidth  - w) / 2);
      const y = Math.round((compositionHeight - h) / 2);
      const layer: Layer = {
        id: generateId(),
        type: 'image',
        position: { x, y },
        size: { width: w, height: h },
        properties: { src: img.url, fit: 'cover', name: img.displayName ?? img.name ?? img.key },
      };
      onAdd(layer);
      onClose();
    };
    el.onerror = () => {
      // Fallback if image can't be measured — use half canvas
      const w = Math.round(compositionWidth / 2);
      const h = Math.round(compositionHeight / 2);
      const layer: Layer = {
        id: generateId(),
        type: 'image',
        position: { x: Math.round(w / 2), y: Math.round(h / 2) },
        size: { width: w, height: h },
        properties: { src: img.url, fit: 'cover', name: img.displayName ?? img.name ?? img.key },
      };
      onAdd(layer);
      onClose();
    };
    el.src = img.url;
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const token = readStoredUser()?.emailVerificationToken;
    const email = readStoredUser()?.email;
    if (!token || !email) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('album', albumName);
      fd.append('userEmail', email);
      const res = await fetch(`${PHOTOS_API}/upload`, {
        method: 'POST',
        headers: { 'X-API-Token': token },
        body: fd,
      });
      if (!res.ok) throw new Error('Upload failed');
      await fetchAlbum(albumName);
    } catch {
      setImagesError('Upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // AI prompt
  const [prompt, setPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const handleSaveKgShape = () => {
    if (!editingLayer || !isKgShape) return;
    let motionScenes: MotionScene[] | undefined;
    try {
      motionScenes = parseMotionScenes(motionScenesJson);
      setMotionScenesError('');
    } catch (error) {
      setMotionScenesError(error instanceof Error ? error.message : 'Invalid motion scenes JSON.');
      return;
    }
    const animation = buildAnimation(kgPreset, compositionDuration, compositionWidth, compositionHeight, kgWidth, kgHeight);
    onAdd({
      ...editingLayer,
      position: { x: kgPosX, y: kgPosY },
      size: { width: kgWidth, height: kgHeight },
      animation,
      properties: {
        ...editingLayer.properties,
        color: kgColor,
        opacity: opacityValue,
        ...(motionScenes ? { motionScenes } : { motionScenes: undefined }),
      },
    });
    onClose();
  };

  const handleSaveCard = () => {
    if (!editingLayer || !isKgCard) return;
    let motionScenes: MotionScene[] | undefined;
    try {
      motionScenes = parseMotionScenes(motionScenesJson);
      setMotionScenesError('');
    } catch (error) {
      setMotionScenesError(error instanceof Error ? error.message : 'Invalid motion scenes JSON.');
      return;
    }
    const animation = buildAnimation(cardPreset, compositionDuration, compositionWidth, compositionHeight, cardWidth, cardHeight);
    onAdd({
      ...editingLayer,
      position: { x: cardPosX, y: cardPosY },
      size: { width: cardWidth, height: cardHeight },
      animation,
      properties: {
        ...editingLayer.properties,
        title: cardTitle,
        body: cardBody,
        ...(cardFontFamily ? { fontFamily: cardFontFamily } : {}),
        opacity: opacityValue,
        ...(motionScenes ? { motionScenes } : { motionScenes: undefined }),
      },
    });
    onClose();
  };

  const handleAdd = () => {
    let motionScenes: MotionScene[] | undefined;
    try {
      motionScenes = parseMotionScenes(motionScenesJson);
      setMotionScenesError('');
    } catch (error) {
      setMotionScenesError(error instanceof Error ? error.message : 'Invalid motion scenes JSON.');
      return;
    }
    const animation = layerType === 'math-shape'
      ? (drawOverTime
          ? {
              property: 'drawProgress',
              keyframes: [
                { time: drawStartTime, value: 0 },
                { time: drawEndTime, value: 1 },
              ],
            }
          : undefined)
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
        ? {
            text,
            fontSize,
            color,
            align,
            fontWeight: '600',
            opacity: opacityValue,
            ...(fontFamily ? { fontFamily } : {}),
            ...(motionScenes ? { motionScenes } : {}),
            ...(fillMode === 'image' && fillSource.trim()
              ? { fillMode: 'image', fillSource: fillSource.trim() }
              : {}),
          }
        : layerType === 'shape'
          ? { shape, color, opacity: opacityValue, ...(motionScenes ? { motionScenes } : {}) }
          : {
              mathKind,
              stroke: color,
              strokeWidth,
              fill: fillColor || null,
              samples,
              tStart,
              tEnd,
              xFormula,
              yFormula,
              closePath,
              opacity: opacityValue,
              ...(motionScenes ? { motionScenes } : {}),
            },
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

  const motionScenesField = (
    <div className="space-y-2">
      <label className="text-xs text-slate-400 block">Advanced motion scenes (JSON)</label>
      <textarea
        value={motionScenesJson}
        onChange={(e) => setMotionScenesJson(e.target.value)}
        rows={6}
        placeholder={`[\n  {\n    "start": 0,\n    "end": 2.5,\n    "xFormula": "x0 + cos(t*2)*120",\n    "yFormula": "y0 + sin(t*2)*60"\n  }\n]`}
        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500 resize-y"
      />
      <p className="text-xs text-slate-500">
        Uses absolute coordinates. Available vars: <code>t</code>, <code>p</code>, <code>x0</code>, <code>y0</code>, <code>w</code>, <code>h</code>, <code>sin</code>, <code>cos</code>, <code>pi</code>.
      </p>
      {motionScenesError && <p className="text-xs text-red-400">{motionScenesError}</p>}
    </div>
  );

  const opacityField = (
    <div className="space-y-2">
      <label className="text-xs text-slate-400 block">Opacity</label>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={opacityValue}
          onChange={(e) => setOpacityValue(parseFloat(e.target.value))}
          className="flex-1 accent-sky-500"
        />
        <input
          type="number"
          min="0"
          max="1"
          step="0.01"
          value={opacityValue}
          onChange={(e) => {
            const next = parseFloat(e.target.value);
            if (Number.isFinite(next)) setOpacityValue(Math.max(0, Math.min(1, next)));
          }}
          className="w-24 bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
      </div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl">

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
              onClick={() => setTab('images')}
              className={`flex-1 py-3 text-sm font-medium transition ${tab === 'images' ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-400 hover:text-white'}`}
            >
              Images
            </button>
            <button
              onClick={() => setTab('animations')}
              className={`flex-1 py-3 text-sm font-medium transition ${tab === 'animations' ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-400 hover:text-white'}`}
            >
              Animations
            </button>
            <button
              onClick={() => setTab('audio')}
              className={`flex-1 py-3 text-sm font-medium transition ${tab === 'audio' ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-400 hover:text-white'}`}
            >
              Audio
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
          {isImgLayer ? (
            <>
              {/* Image preview */}
              <div className="flex justify-center py-2">
                <div className="w-40 h-28 bg-slate-800 rounded-lg overflow-hidden flex items-center justify-center border border-slate-700">
                  <img
                    src={editingLayer.properties.src as string}
                    alt=""
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500 text-center truncate">{editingLayer.properties.src as string}</p>

              {/* Fit mode */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Fit</label>
                <div className="flex gap-2">
                  {(['cover', 'contain', 'fill'] as const).map(f => (
                    <button key={f} onClick={() => setImgFit(f)}
                      className={`flex-1 py-2 rounded-lg text-sm capitalize transition ${imgFit === f ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {opacityField}

              {/* Position & size */}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-slate-400 mb-1 block">Position X</label>
                  <input type="number" value={imgPosX} onChange={e => setImgPosX(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div><label className="text-xs text-slate-400 mb-1 block">Position Y</label>
                  <input type="number" value={imgPosY} onChange={e => setImgPosY(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div><label className="text-xs text-slate-400 mb-1 block">Width</label>
                  <input type="number" value={imgWidth} onChange={e => setImgWidth(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div><label className="text-xs text-slate-400 mb-1 block">Height</label>
                  <input type="number" value={imgHeight} onChange={e => setImgHeight(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
              </div>

              {/* Animation */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-slate-400">Animation</label>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  {([
                    { value: 'none',        label: 'None' },
                    { value: 'fade-in',     label: 'Fade In' },
                    { value: 'fade-out',    label: 'Fade Out' },
                    { value: 'fade-in-out', label: 'Fade In/Out' },
                    { value: 'slide',       label: 'Slide' },
                    { value: 'bounce',      label: 'Bounce' },
                  ] as { value: ImgAnimType; label: string }[]).map(opt => (
                    <button key={opt.value} onClick={() => setImgAnimType(opt.value)}
                      className={`py-2 rounded-lg text-sm transition ${imgAnimType === opt.value ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {imgAnimType !== 'none' && (
                  <div className="space-y-3">
                    {imgAnimType === 'slide' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className="text-xs text-slate-400 mb-1 block">Start X</label>
                          <input type="number" value={animStartX} onChange={e => setAnimStartX(parseInt(e.target.value))}
                            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                        <div><label className="text-xs text-slate-400 mb-1 block">Start Y</label>
                          <input type="number" value={animStartY} onChange={e => setAnimStartY(parseInt(e.target.value))}
                            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                        <div><label className="text-xs text-slate-400 mb-1 block">End X</label>
                          <input type="number" value={animEndX} onChange={e => setAnimEndX(parseInt(e.target.value))}
                            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                        <div><label className="text-xs text-slate-400 mb-1 block">End Y</label>
                          <input type="number" value={animEndY} onChange={e => setAnimEndY(parseInt(e.target.value))}
                            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="text-xs text-slate-400 mb-1 block">Start time (s)</label>
                        <input type="number" step="0.1" min="0" value={animStartTime} onChange={e => setAnimStartTime(parseFloat(e.target.value))}
                          className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                      <div><label className="text-xs text-slate-400 mb-1 block">End time (s)</label>
                        <input type="number" step="0.1" min="0" value={animEndTime} onChange={e => setAnimEndTime(parseFloat(e.target.value))}
                          className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                    </div>
                    {imgAnimType === 'slide' && (
                      <p className="text-xs text-slate-500">Canvas: {compositionWidth} × {compositionHeight}. Use negative values to start off-screen.</p>
                    )}
                  </div>
                )}
              </div>

              {motionScenesField}

              <button onClick={handleSaveImage}
                className="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg py-3 transition">
                Save Changes
              </button>
            </>
          ) : isKgCard ? (
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
              <div><label className="text-xs text-slate-400 mb-1 block">Font override</label>
                <select value={cardFontFamily} onChange={e => setCardFontFamily(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  style={{ fontFamily: cardFontFamily || undefined }}>
                  {FONT_OPTIONS.map(f => (
                    <option key={f.value} value={f.value} style={{ fontFamily: f.value || undefined }}>{f.label}</option>
                  ))}
                </select>
              </div>
              {opacityField}
              {motionScenesField}
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
              {opacityField}
              {motionScenesField}
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
          ) : tab === 'images' ? (
            <>
              {/* Album picker + upload */}
              <div className="flex gap-2">
                <input
                  value={albumName}
                  onChange={e => setAlbumName(e.target.value)}
                  onBlur={() => fetchAlbum(albumName)}
                  onKeyDown={e => e.key === 'Enter' && fetchAlbum(albumName)}
                  placeholder="Album name"
                  className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg text-sm transition"
                >
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Upload
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
              </div>

              {imagesLoading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}
              {imagesError && <p className="text-red-400 text-sm">{imagesError}</p>}

              <div className="grid grid-cols-3 gap-3 max-h-80 overflow-y-auto">
                {albumImages.map(img => (
                  <button
                    key={img.key}
                    onClick={() => handleImagePick(img)}
                    className="flex flex-col items-center gap-1 p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-sky-500 rounded-xl transition group"
                  >
                    <div className="w-full aspect-square bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center">
                      <img
                        src={img.url}
                        alt={img.displayName ?? img.key}
                        className="w-full h-full object-contain"
                        loading="lazy"
                      />
                    </div>
                    <span className="text-xs text-slate-400 group-hover:text-white truncate w-full text-center">
                      {img.displayName ?? img.name ?? img.key}
                    </span>
                    {img.tags && img.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 justify-center">
                        {img.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="text-xs bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded-full">{tag}</span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : tab === 'manual' ? (
            <>
              {/* Layer type */}
              <div className="flex gap-2">
                {(['text', 'shape', 'math-shape'] as const).map(t => (
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
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Font override</label>
                    <select value={fontFamily} onChange={e => setFontFamily(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      style={{ fontFamily: fontFamily || undefined }}>
                      {FONT_OPTIONS.map(f => (
                        <option key={f.value} value={f.value} style={{ fontFamily: f.value || undefined }}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  {/* Text fill — solid (uses Color above) or image (letters become a window onto the URL) */}
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Text fill</label>
                    <select
                      value={fillMode}
                      onChange={e => setFillMode(e.target.value as 'solid' | 'image')}
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      <option value="solid">Solid color</option>
                      <option value="image">Image (letters mask image)</option>
                    </select>
                  </div>
                  {fillMode === 'image' && (
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Image URL</label>
                      <input
                        value={fillSource}
                        onChange={e => setFillSource(e.target.value)}
                        placeholder="https://example.com/image.jpg"
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                      <p className="text-xs text-slate-500 mt-1">
                        The image is cover-fit into the layer bounds and clipped to the letter shapes. Must be CORS-accessible.
                      </p>
                    </div>
                  )}
                </>
              ) : layerType === 'shape' ? (
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
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">
                    Parametric curve. Use <code>t</code> from <code>tStart</code> to <code>tEnd</code>. Available vars: <code>x0</code>, <code>y0</code>, <code>w</code>, <code>h</code>, <code>sin</code>, <code>cos</code>, <code>min</code>, <code>max</code>, <code>pi</code>.
                  </p>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Preset</label>
                    <select
                      value={mathPreset}
                      onChange={e => applyMathShapePreset(e.target.value as MathShapePresetKey)}
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      {Object.entries(MATH_SHAPE_PRESETS).map(([key, preset]) => (
                        <option key={key} value={key}>{preset.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Samples</label>
                      <input type="number" value={samples} onChange={e => setSamples(parseInt(e.target.value) || 180)}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Stroke width</label>
                      <input type="number" step="0.5" value={strokeWidth} onChange={e => setStrokeWidth(parseFloat(e.target.value) || 3)}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">tStart</label>
                      <input type="number" step="0.01" value={tStart} onChange={e => setTStart(parseFloat(e.target.value) || 0)}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">tEnd</label>
                      <input type="number" step="0.01" value={tEnd} onChange={e => setTEnd(parseFloat(e.target.value) || Math.PI * 2)}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">xFormula</label>
                    <input value={xFormula} onChange={e => setXFormula(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">yFormula</label>
                    <input value={yFormula} onChange={e => setYFormula(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500" />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={closePath} onChange={e => setClosePath(e.target.checked)} />
                    Close path
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={drawOverTime} onChange={e => setDrawOverTime(e.target.checked)} />
                    Draw over time
                  </label>
                  {drawOverTime && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Draw start (s)</label>
                        <input type="number" step="0.1" min="0" value={drawStartTime} onChange={e => setDrawStartTime(parseFloat(e.target.value) || 0)}
                          className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Draw end (s)</label>
                        <input type="number" step="0.1" min="0" value={drawEndTime} onChange={e => setDrawEndTime(parseFloat(e.target.value) || Math.min(3, compositionDuration))}
                          className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Optional fill</label>
                    <input value={fillColor} onChange={e => setFillColor(e.target.value)}
                      placeholder="#0ea5e9 or leave blank"
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500" />
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
              {opacityField}
              {motionScenesField}

              {/* Animation preset — text layers get char-stagger effects (Type-on etc.) in addition to PRESETS */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Animation</label>
                <select value={preset} onChange={e => setPreset(e.target.value as AnimationPreset)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                  {(layerType === 'text' ? TEXT_PRESETS : PRESETS).map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>

              <button onClick={handleAdd}
                className="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg py-3 transition">
                {isEditing ? 'Save Changes' : 'Add Layer'}
              </button>
            </>
          ) : tab === 'audio' ? (
            <AudioLayerForm
              compositionDuration={compositionDuration}
              editingLayer={editingLayer?.type === 'audio' ? editingLayer : undefined}
              onAdd={(layer) => { onAdd(layer); onClose(); }}
            />
          ) : tab === 'animations' ? (
            <>
              <p className="text-xs text-slate-400 mb-4">Pick an animation from the library. It will be applied to the selected layer, or you can add a new text/shape layer with it.</p>
              {kgAnims.length === 0 && <div className="text-xs text-slate-500 text-center py-6">Loading animations...</div>}
              <div className="grid grid-cols-2 gap-4">
                {kgAnims.map(anim => (
                  <button
                    key={anim.id}
                    onClick={() => {
                      setPreset(anim.id as AnimationPreset);
                      setImgAnimType(anim.id as ImgAnimType);
                      setTab('manual');
                    }}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border border-slate-700 hover:border-sky-500 bg-slate-800 hover:bg-slate-700 transition group"
                  >
                    <div className="w-full h-16 rounded-lg flex items-center justify-center" style={{ background: anim.color + '22', border: `2px solid ${anim.color}` }}>
                      <div className="w-6 h-6 rounded-full" style={{ background: anim.color }} />
                    </div>
                    <span className="text-sm text-slate-300 group-hover:text-white font-medium text-center">{anim.label}</span>
                  </button>
                ))}
              </div>
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
    </div>,
    document.body
  );
};
