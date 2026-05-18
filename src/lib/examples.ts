import type { CompositionData } from './api';
import { DAGLAR_ILE_TASLAR_ILE_FLUTE_LESSON } from './neyLessonData';

export const movementOverTimeExample: CompositionData = {
  duration: 5,
  fps: 30,
  width: 1280,
  height: 720,
  layers: [
    {
      id: 'bg',
      type: 'shape',
      position: { x: 0, y: 0 },
      size: { width: 1280, height: 720 },
      properties: { shape: 'rect', color: '#020617', opacity: 1 },
    },
    {
      id: 'title',
      type: 'text',
      position: { x: 84, y: 34 },
      size: { width: 1112, height: 56 },
      properties: {
        text: 'Movement over Time',
        fontSize: 34,
        color: '#e2e8f0',
        align: 'left',
        fontWeight: '700',
        opacity: 1,
      },
      animation: {
        property: 'opacity',
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.4, value: 1 },
        ],
      },
    },
    {
      id: 'subtitle',
      type: 'text',
      position: { x: 84, y: 82 },
      size: { width: 1112, height: 38 },
      properties: {
        text: 'A sine wave drawn as a graph, with a point following the curve.',
        fontSize: 18,
        color: '#94a3b8',
        align: 'left',
        fontWeight: '500',
        opacity: 1,
      },
      animation: {
        property: 'opacity',
        keyframes: [
          { time: 0.1, value: 0 },
          { time: 0.7, value: 1 },
        ],
      },
    },
    {
      id: 'x-axis',
      type: 'shape',
      position: { x: 120, y: 580 },
      size: { width: 1040, height: 2 },
      properties: { shape: 'rect', color: '#475569', opacity: 1 },
      animation: {
        property: 'opacity',
        keyframes: [
          { time: 0.2, value: 0 },
          { time: 0.6, value: 1 },
        ],
      },
    },
    {
      id: 'y-axis',
      type: 'shape',
      position: { x: 120, y: 120 },
      size: { width: 2, height: 460 },
      properties: { shape: 'rect', color: '#475569', opacity: 1 },
      animation: {
        property: 'opacity',
        keyframes: [
          { time: 0.2, value: 0 },
          { time: 0.6, value: 1 },
        ],
      },
    },
    {
      id: 'x-label',
      type: 'text',
      position: { x: 1010, y: 596 },
      size: { width: 150, height: 32 },
      properties: {
        text: 'time',
        fontSize: 16,
        color: '#94a3b8',
        align: 'right',
        fontWeight: '500',
        opacity: 1,
      },
    },
    {
      id: 'y-label',
      type: 'text',
      position: { x: 134, y: 126 },
      size: { width: 180, height: 32 },
      properties: {
        text: 'movement',
        fontSize: 16,
        color: '#94a3b8',
        align: 'left',
        fontWeight: '500',
        opacity: 1,
      },
    },
    {
      id: 'curve',
      type: 'math-shape',
      position: { x: 120, y: 120 },
      size: { width: 1040, height: 460 },
      properties: {
        mathKind: 'parametric',
        stroke: '#38bdf8',
        strokeWidth: 4,
        fill: null,
        samples: 320,
        tStart: 0,
        tEnd: 1,
        xFormula: 'x0 + p*w',
        yFormula: 'y0 + h/2 - sin(p*pi*4)*h*0.32',
        closePath: false,
        opacity: 1,
      },
      animation: {
        property: 'drawProgress',
        keyframes: [
          { time: 0, value: 0 },
          { time: 3, value: 1 },
        ],
      },
    },
    {
      id: 'dot',
      type: 'shape',
      position: { x: 111, y: 341 },
      size: { width: 18, height: 18 },
      properties: {
        shape: 'circle',
        color: '#f59e0b',
        opacity: 1,
        motionScenes: [
          {
            start: 0,
            end: 5,
            xFormula: '120 + p*1040 - 9',
            yFormula: '120 + 230 - sin(p*pi*4)*147.2 - 9',
          },
        ],
      },
      animation: {
        property: 'opacity',
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.15, value: 1 },
        ],
      },
    },
  ],
};

const flutePhraseNotes = DAGLAR_ILE_TASLAR_ILE_FLUTE_LESSON.notes;
const fluteTrackStartX = 180;
const fluteTrackSpacing = 58;
const fluteTrackY = 144;
const fluteTrackDotSize = 12;
const fluteWheelCenterX = 645;
const fluteWheelCenterY = 396;
const fluteWheelRadius = 142;
const fluteBigSolfegeY = 612;
const fluteBigSolfegeWidth = 220;
const fluteBigSolfegeX = fluteWheelCenterX - fluteBigSolfegeWidth / 2;

const solfegeSlots: Record<string, { x: number; y: number }> = {
  do: { x: 0, y: fluteWheelRadius - 26 },
  re: { x: -94, y: 46 },
  mi: { x: -82, y: -52 },
  fa: { x: 0, y: -(fluteWheelRadius - 16) },
  sol: { x: 104, y: -44 },
  'sol#': { x: 104, y: -44 },
  la: { x: 112, y: 34 },
  si: { x: 0, y: 4 },
};

const flutePointScenes = flutePhraseNotes.map((note, index) => ({
  start: note.startSeconds,
  end: note.startSeconds + note.durationSeconds,
  xFormula: `${fluteTrackStartX + index * fluteTrackSpacing - 16}`,
  yFormula: `${fluteTrackY - 16}`,
}));

const fluteWheelDotScenes = flutePhraseNotes.map((note) => {
  const slot = solfegeSlots[note.solfege] ?? solfegeSlots.do;
  return {
    start: note.startSeconds,
    end: note.startSeconds + note.durationSeconds,
    xFormula: `${fluteWheelCenterX + slot.x - 18}`,
    yFormula: `${fluteWheelCenterY + slot.y - 18}`,
  };
});

const fluteSolfegeLayers = flutePhraseNotes.map((note, index) => ({
  id: `flute-solfege-${index}`,
  type: 'text' as const,
  position: { x: fluteBigSolfegeX, y: fluteBigSolfegeY },
  size: { width: fluteBigSolfegeWidth, height: 64 },
  properties: {
    text: note.solfege.toUpperCase(),
    fontSize: 38,
    color: '#123047',
    align: 'center',
    fontWeight: '700',
    opacity: 0,
  },
  animation: {
    property: 'opacity',
    keyframes: [
      { time: Math.max(0, note.startSeconds - 0.04), value: 0 },
      { time: note.startSeconds + 0.02, value: 1 },
      { time: note.startSeconds + note.durationSeconds - 0.02, value: 1 },
      { time: note.startSeconds + note.durationSeconds + 0.04, value: 0 },
    ],
  },
}));

const flutePitchLayers = flutePhraseNotes.map((note, index) => ({
  id: `flute-pitch-${index}`,
  type: 'text' as const,
  position: { x: 932, y: 220 },
  size: { width: 220, height: 50 },
  properties: {
    text: note.pitch,
    fontSize: 28,
    color: '#14364a',
    align: 'left',
    fontWeight: '700',
    opacity: 0,
  },
  animation: {
    property: 'opacity',
    keyframes: [
      { time: Math.max(0, note.startSeconds - 0.04), value: 0 },
      { time: note.startSeconds + 0.02, value: 1 },
      { time: note.startSeconds + note.durationSeconds - 0.02, value: 1 },
      { time: note.startSeconds + note.durationSeconds + 0.04, value: 0 },
    ],
  },
}));

const fluteTimingLayers = flutePhraseNotes.map((note, index) => ({
  id: `flute-timing-${index}`,
  type: 'text' as const,
  position: { x: 932, y: 266 },
  size: { width: 280, height: 70 },
  properties: {
    text: `m${note.measure} · beat ${note.beat}\n${note.durationBeats} beat · ${note.durationSeconds.toFixed(4)}s`,
    fontSize: 18,
    color: '#486173',
    align: 'left',
    fontWeight: '500',
    opacity: 0,
  },
  animation: {
    property: 'opacity',
    keyframes: [
      { time: Math.max(0, note.startSeconds - 0.04), value: 0 },
      { time: note.startSeconds + 0.02, value: 1 },
      { time: note.startSeconds + note.durationSeconds - 0.02, value: 1 },
      { time: note.startSeconds + note.durationSeconds + 0.04, value: 0 },
    ],
  },
}));

const fluteVerificationText = [
  'verify from .mxl',
  ...flutePhraseNotes.map(
    (note, index) =>
      `${String(index + 1).padStart(2, '0')}  m${note.measure} b${note.beat}  ${note.solfege.padEnd(4, ' ')} ${note.pitch.padEnd(3, ' ')}  ${note.durationBeats} beat  ${note.startSeconds.toFixed(4)}s`
  ),
].join('\n');

const fluteMeasureNumbers = [
  { id: 'measure-1', text: '1', x: fluteTrackStartX + fluteTrackSpacing * 3.8 },
  { id: 'measure-2', text: '2', x: fluteTrackStartX + fluteTrackSpacing * 8.3 },
];

const fluteTopDotLayers = flutePhraseNotes.map((_, index) => ({
  id: `flute-track-dot-${index}`,
  type: 'shape' as const,
  position: {
    x: fluteTrackStartX + index * fluteTrackSpacing - fluteTrackDotSize / 2,
    y: fluteTrackY - fluteTrackDotSize / 2,
  },
  size: { width: fluteTrackDotSize, height: fluteTrackDotSize },
  properties: {
    shape: 'circle',
    color: '#1d334a',
    opacity: 0.92,
  },
}));

const fluteTopSolfegeLabels = flutePhraseNotes.map((note, index) => ({
  id: `flute-track-label-${index}`,
  type: 'text' as const,
  position: { x: fluteTrackStartX + index * fluteTrackSpacing - 30, y: fluteTrackY + 22 },
  size: { width: 60, height: 24 },
  properties: {
    text: note.solfege,
    fontSize: 12,
    color: '#68879a',
    align: 'center',
    fontWeight: '600',
    opacity: 1,
  },
}));

const fluteWheelTextLayers = [
  { id: 'wheel-do', text: 'DO', x: fluteWheelCenterX - 24, y: fluteWheelCenterY + fluteWheelRadius - 8 },
  { id: 'wheel-re', text: 'RE', x: fluteWheelCenterX - 118, y: fluteWheelCenterY + 36 },
  { id: 'wheel-mi', text: 'MI', x: fluteWheelCenterX - 126, y: fluteWheelCenterY - 60 },
  { id: 'wheel-fa', text: 'FA', x: fluteWheelCenterX - 18, y: fluteWheelCenterY - fluteWheelRadius - 6 },
  { id: 'wheel-sol', text: 'SOL', x: fluteWheelCenterX + 86, y: fluteWheelCenterY - 52 },
  { id: 'wheel-la', text: 'LA', x: fluteWheelCenterX + 100, y: fluteWheelCenterY + 28 },
  { id: 'wheel-si', text: 'SI', x: fluteWheelCenterX - 16, y: fluteWheelCenterY - 6 },
].map((item) => ({
  id: item.id,
  type: 'text' as const,
  position: { x: item.x, y: item.y },
  size: { width: 48, height: 24 },
  properties: {
    text: item.text,
    fontSize: 16,
    color: '#204458',
    align: 'center',
    fontWeight: '700',
    opacity: 1,
  },
}));

export const neyLessonExample: CompositionData = {
  duration: 9,
  fps: 30,
  width: 1280,
  height: 720,
  layers: [
    {
      id: 'bg',
      type: 'shape',
      position: { x: 0, y: 0 },
      size: { width: 1280, height: 720 },
      properties: { shape: 'rect', color: '#aec6d6', opacity: 1 },
    },
    {
      id: 'card-shadow',
      type: 'shape',
      position: { x: 72, y: 34 },
      size: { width: 1136, height: 652 },
      properties: { shape: 'rect', color: '#7b91a3', opacity: 0.18 },
    },
    {
      id: 'panel',
      type: 'shape',
      position: { x: 52, y: 28 },
      size: { width: 1176, height: 664 },
      properties: { shape: 'rect', color: '#edf5f8', opacity: 1 },
    },
    {
      id: 'header-divider',
      type: 'shape',
      position: { x: 92, y: 193 },
      size: { width: 1094, height: 2 },
      properties: { shape: 'rect', color: '#b6d5df', opacity: 1 },
    },
    {
      id: 'track-progress',
      type: 'shape',
      position: { x: 92, y: 193 },
      size: { width: 520, height: 5 },
      properties: { shape: 'rect', color: '#6ec6d6', opacity: 1 },
    },
    {
      id: 'title',
      type: 'text',
      position: { x: 88, y: 54 },
      size: { width: 580, height: 60 },
      properties: {
        text: 'Dağlar İle Taşlar İle',
        fontSize: 42,
        color: '#12263b',
        align: 'left',
        fontWeight: '700',
        opacity: 1,
      },
    },
    {
      id: 'subtitle',
      type: 'text',
      position: { x: 90, y: 102 },
      size: { width: 620, height: 32 },
      properties: {
        text: 'Flute lesson · first phrase',
        fontSize: 20,
        color: '#607789',
        align: 'left',
        fontWeight: '600',
        opacity: 1,
      },
    },
    {
      id: 'brand',
      type: 'text',
      position: { x: 964, y: 64 },
      size: { width: 180, height: 34 },
      properties: {
        text: 'Harmony Flow',
        fontSize: 24,
        color: '#1b5968',
        align: 'left',
        fontWeight: '700',
        opacity: 1,
      },
    },
    {
      id: 'lesson-point-label',
      type: 'text',
      position: { x: 92, y: 212 },
      size: { width: 360, height: 28 },
      properties: {
        text: 'Track 1 · Flute',
        fontSize: 14,
        color: '#1c384f',
        align: 'left',
        fontWeight: '700',
        opacity: 1,
      },
    },
    {
      id: 'lesson-active-label',
      type: 'text',
      position: { x: 932, y: 184 },
      size: { width: 180, height: 28 },
      properties: {
        text: 'active note',
        fontSize: 14,
        color: '#1c5668',
        align: 'left',
        fontWeight: '700',
        opacity: 1,
      },
    },
    {
      id: 'lesson-source',
      type: 'text',
      position: { x: 104, y: 636 },
      size: { width: 720, height: 26 },
      properties: {
        text: `${DAGLAR_ILE_TASLAR_ILE_FLUTE_LESSON.source} · tempo ${DAGLAR_ILE_TASLAR_ILE_FLUTE_LESSON.tempo}`,
        fontSize: 14,
        color: '#688191',
        align: 'left',
        fontWeight: '500',
        opacity: 1,
      },
    },
    {
      id: 'verification-title',
      type: 'text',
      position: { x: 932, y: 328 },
      size: { width: 240, height: 28 },
      properties: {
        text: 'parsed notes',
        fontSize: 14,
        color: '#1c5668',
        align: 'left',
        fontWeight: '700',
        opacity: 1,
      },
    },
    {
      id: 'verification-block',
      type: 'text',
      position: { x: 932, y: 360 },
      size: { width: 300, height: 252 },
      properties: {
        text: fluteVerificationText,
        fontSize: 12,
        color: '#436173',
        align: 'left',
        fontWeight: '500',
        opacity: 1,
      },
    },
    {
      id: 'track-line',
      type: 'shape',
      position: { x: 108, y: fluteTrackY - 1 },
      size: { width: 968, height: 2 },
      properties: { shape: 'rect', color: '#9ab9c6', opacity: 1 },
    },
    ...fluteMeasureNumbers.map((measure) => ({
      id: measure.id,
      type: 'text' as const,
      position: { x: measure.x - 12, y: 104 },
      size: { width: 24, height: 24 },
      properties: {
        text: measure.text,
        fontSize: 16,
        color: '#556f81',
        align: 'center',
        fontWeight: '700',
        opacity: 1,
      },
    })),
    ...fluteTopDotLayers,
    ...fluteTopSolfegeLabels,
    {
      id: 'track-playhead-band',
      type: 'shape',
      position: { x: fluteTrackStartX - 12, y: 96 },
      size: { width: 22, height: 86 },
      properties: {
        shape: 'rect',
        color: '#9dd6e0',
        opacity: 0.35,
        motionScenes: flutePointScenes.map((scene) => ({
          ...scene,
          yFormula: '96',
        })),
      },
    },
    {
      id: 'track-playhead-line',
      type: 'shape',
      position: { x: fluteTrackStartX - 1, y: 94 },
      size: { width: 4, height: 92 },
      properties: {
        shape: 'rect',
        color: '#2f6f82',
        opacity: 0.92,
        motionScenes: flutePointScenes.map((scene) => ({
          ...scene,
          xFormula: `${scene.xFormula} + 11`,
          yFormula: '94',
        })),
      },
    },
    {
      id: 'wheel-ring-1',
      type: 'shape',
      position: { x: fluteWheelCenterX - 196, y: fluteWheelCenterY - 196 },
      size: { width: 392, height: 392 },
      properties: { shape: 'circle', color: '#cfdcf2', opacity: 0.78 },
    },
    {
      id: 'wheel-ring-2',
      type: 'shape',
      position: { x: fluteWheelCenterX - 154, y: fluteWheelCenterY - 154 },
      size: { width: 308, height: 308 },
      properties: { shape: 'circle', color: '#d8eddc', opacity: 0.82 },
    },
    {
      id: 'wheel-ring-3',
      type: 'shape',
      position: { x: fluteWheelCenterX - 112, y: fluteWheelCenterY - 112 },
      size: { width: 224, height: 224 },
      properties: { shape: 'circle', color: '#d8ebef', opacity: 0.92 },
    },
    {
      id: 'wheel-ring-4',
      type: 'shape',
      position: { x: fluteWheelCenterX - 70, y: fluteWheelCenterY - 70 },
      size: { width: 140, height: 140 },
      properties: { shape: 'circle', color: '#dce3f6', opacity: 0.96 },
    },
    {
      id: 'wheel-center',
      type: 'shape',
      position: { x: fluteWheelCenterX - 34, y: fluteWheelCenterY - 34 },
      size: { width: 68, height: 68 },
      properties: { shape: 'circle', color: '#edf5f8', opacity: 1 },
    },
    ...fluteWheelTextLayers,
    ...fluteSolfegeLayers,
    ...flutePitchLayers,
    ...fluteTimingLayers,
    {
      id: 'flute-point',
      type: 'shape',
      position: { x: fluteTrackStartX - 16, y: fluteTrackY - 16 },
      size: { width: 32, height: 32 },
      properties: {
        shape: 'circle',
        color: '#2e8ca5',
        opacity: 1,
        motionScenes: flutePointScenes,
      },
      animation: {
        property: 'opacity',
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.12, value: 1 },
        ],
      },
    },
    {
      id: 'flute-wheel-dot',
      type: 'shape',
      position: { x: fluteWheelCenterX - 18, y: fluteWheelCenterY + fluteWheelRadius - 44 },
      size: { width: 36, height: 36 },
      properties: {
        shape: 'circle',
        color: '#69c0d3',
        opacity: 1,
        motionScenes: fluteWheelDotScenes,
      },
      animation: {
        property: 'opacity',
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.12, value: 1 },
        ],
      },
    },
  ],
};
