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
const flutePointStartX = 170;
const flutePointSpacing = 58;
const flutePointY = 265;
const flutePointSize = 26;
const fluteSolfegeY = 322;

const flutePointScenes = flutePhraseNotes.map((note, index) => ({
  start: note.startSeconds,
  end: note.startSeconds + note.durationSeconds,
  xFormula: `${flutePointStartX + index * flutePointSpacing}`,
  yFormula: `${flutePointY}`,
}));

const fluteSolfegeLayers = flutePhraseNotes.map((note, index) => {
  const x = flutePointStartX + index * flutePointSpacing - 72;
  return {
    id: `flute-solfege-${index}`,
    type: 'text' as const,
    position: { x, y: fluteSolfegeY },
    size: { width: 144, height: 64 },
    properties: {
      text: note.solfege,
      fontSize: 34,
      color: '#f8fafc',
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
  };
});

const flutePitchLayers = flutePhraseNotes.map((note, index) => ({
  id: `flute-pitch-${index}`,
  type: 'text' as const,
  position: { x: 860, y: 170 },
  size: { width: 220, height: 50 },
  properties: {
    text: note.pitch,
    fontSize: 28,
    color: '#f8fafc',
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
  position: { x: 860, y: 214 },
  size: { width: 280, height: 70 },
  properties: {
    text: `m${note.measure} · beat ${note.beat}\n${note.durationBeats} beat · ${note.durationSeconds.toFixed(4)}s`,
    fontSize: 20,
    color: '#cbd5e1',
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
      properties: { shape: 'rect', color: '#0b1220', opacity: 1 },
    },
    {
      id: 'panel',
      type: 'shape',
      position: { x: 60, y: 52 },
      size: { width: 1160, height: 616 },
      properties: { shape: 'rect', color: '#111827', opacity: 1 },
    },
    {
      id: 'title',
      type: 'text',
      position: { x: 92, y: 78 },
      size: { width: 580, height: 60 },
      properties: {
        text: 'Dağlar İle Taşlar İle',
        fontSize: 38,
        color: '#f8fafc',
        align: 'left',
        fontWeight: '700',
        opacity: 1,
      },
    },
    {
      id: 'subtitle',
      type: 'text',
      position: { x: 92, y: 126 },
      size: { width: 620, height: 32 },
      properties: {
        text: 'Flute lesson · first phrase · point + solfège only',
        fontSize: 18,
        color: '#94a3b8',
        align: 'left',
        fontWeight: '500',
        opacity: 1,
      },
    },
    {
      id: 'lesson-point-label',
      type: 'text',
      position: { x: 150, y: 202 },
      size: { width: 360, height: 28 },
      properties: {
        text: 'active point / rhythm',
        fontSize: 14,
        color: '#67d7ff',
        align: 'left',
        fontWeight: '700',
        opacity: 1,
      },
    },
    {
      id: 'lesson-active-label',
      type: 'text',
      position: { x: 860, y: 128 },
      size: { width: 180, height: 28 },
      properties: {
        text: 'active note',
        fontSize: 14,
        color: '#67d7ff',
        align: 'left',
        fontWeight: '700',
        opacity: 1,
      },
    },
    {
      id: 'lesson-source',
      type: 'text',
      position: { x: 92, y: 598 },
      size: { width: 720, height: 26 },
      properties: {
        text: `${DAGLAR_ILE_TASLAR_ILE_FLUTE_LESSON.source} · tempo ${DAGLAR_ILE_TASLAR_ILE_FLUTE_LESSON.tempo}`,
        fontSize: 14,
        color: '#64748b',
        align: 'left',
        fontWeight: '500',
        opacity: 1,
      },
    },
    {
      id: 'verification-title',
      type: 'text',
      position: { x: 860, y: 320 },
      size: { width: 240, height: 28 },
      properties: {
        text: 'parsed notes',
        fontSize: 14,
        color: '#67d7ff',
        align: 'left',
        fontWeight: '700',
        opacity: 1,
      },
    },
    {
      id: 'verification-block',
      type: 'text',
      position: { x: 860, y: 352 },
      size: { width: 300, height: 252 },
      properties: {
        text: fluteVerificationText,
        fontSize: 12,
        color: '#cbd5e1',
        align: 'left',
        fontWeight: '500',
        opacity: 1,
      },
    },
    ...fluteSolfegeLayers,
    ...flutePitchLayers,
    ...fluteTimingLayers,
    {
      id: 'flute-point',
      type: 'shape',
      position: { x: flutePointStartX, y: flutePointY },
      size: { width: flutePointSize, height: flutePointSize },
      properties: {
        shape: 'circle',
        color: '#67d7ff',
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
  ],
};
