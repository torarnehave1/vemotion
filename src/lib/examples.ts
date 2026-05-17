import type { CompositionData } from './api';

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

type NeyLessonNote = {
  id: string;
  measure: number;
  startSeconds: number;
  durationSeconds: number;
  pitch: string;
  solfege: string;
  x: number;
  y: number;
};

const neyPhraseNotes: NeyLessonNote[] = [
  { id: 'P1-m1-n0', measure: 1, startSeconds: 0.0, durationSeconds: 0.9231, pitch: 'E4', solfege: 'mi', x: 99.27, y: -40.0 },
  { id: 'P1-m1-n1', measure: 1, startSeconds: 0.9231, durationSeconds: 0.9231, pitch: 'A4', solfege: 'la', x: 137.46, y: -25.0 },
  { id: 'P1-m1-n2', measure: 1, startSeconds: 1.8462, durationSeconds: 0.2308, pitch: 'B4', solfege: 'si', x: 175.65, y: -20.0 },
  { id: 'P1-m1-n3', measure: 1, startSeconds: 2.0769, durationSeconds: 0.2308, pitch: 'A4', solfege: 'la', x: 193.65, y: -25.0 },
  { id: 'P1-m1-n4', measure: 1, startSeconds: 2.3077, durationSeconds: 0.2308, pitch: 'A4', solfege: 'la', x: 211.65, y: -25.0 },
  { id: 'P1-m1-n5', measure: 1, startSeconds: 2.5385, durationSeconds: 0.2308, pitch: 'G#4', solfege: 'sol#', x: 229.65, y: -30.0 },
  { id: 'P1-m1-n6', measure: 1, startSeconds: 2.7692, durationSeconds: 0.9231, pitch: 'A4', solfege: 'la', x: 247.65, y: -25.0 },
  { id: 'P1-m2-n0', measure: 2, startSeconds: 3.6923, durationSeconds: 0.4615, pitch: 'G#4', solfege: 'sol#', x: 12.5, y: -30.0 },
  { id: 'P1-m2-n1', measure: 2, startSeconds: 4.1538, durationSeconds: 0.4615, pitch: 'A4', solfege: 'la', x: 37.96, y: -25.0 },
  { id: 'P1-m2-n2', measure: 2, startSeconds: 4.6154, durationSeconds: 0.4615, pitch: 'B4', solfege: 'si', x: 63.42, y: -20.0 },
  { id: 'P1-m2-n3', measure: 2, startSeconds: 5.0769, durationSeconds: 0.4615, pitch: 'C5', solfege: 'do', x: 88.88, y: -15.0 },
  { id: 'P1-m2-n4', measure: 2, startSeconds: 5.5385, durationSeconds: 0.2308, pitch: 'B4', solfege: 'si', x: 114.34, y: -20.0 },
  { id: 'P1-m2-n5', measure: 2, startSeconds: 5.7692, durationSeconds: 0.2308, pitch: 'A4', solfege: 'la', x: 132.34, y: -25.0 },
  { id: 'P1-m2-n6', measure: 2, startSeconds: 6.0, durationSeconds: 0.2308, pitch: 'A4', solfege: 'la', x: 150.34, y: -25.0 },
  { id: 'P1-m2-n7', measure: 2, startSeconds: 6.2308, durationSeconds: 0.2308, pitch: 'G#4', solfege: 'sol#', x: 168.34, y: -30.0 },
  { id: 'P1-m2-n8', measure: 2, startSeconds: 6.4615, durationSeconds: 0.9231, pitch: 'A4', solfege: 'la', x: 186.34, y: -25.0 },
];

const mapNeyNoteX = (note: NeyLessonNote) => {
  const measureOffset = note.measure === 1 ? 0 : 290;
  return 210 + note.x + measureOffset;
};

const mapNeyNoteY = (note: NeyLessonNote) => {
  const minY = -40;
  const maxY = -15;
  const progress = (note.y - minY) / (maxY - minY);
  return 248 + progress * 112;
};

const staffLayers = Array.from({ length: 5 }, (_, index) => ({
  id: `ney-staff-${index + 1}`,
  type: 'shape' as const,
  position: { x: 180, y: 248 + index * 28 },
  size: { width: 860, height: 1 },
  properties: { shape: 'rect', color: '#64748b', opacity: 0.9 },
}));

const noteLayers = neyPhraseNotes.flatMap((note, index) => {
  const x = mapNeyNoteX(note);
  const y = mapNeyNoteY(note);
  const short = note.durationSeconds <= 0.25;
  return [
    {
      id: `ney-notehead-${index}`,
      type: 'shape' as const,
      position: { x: x - 11, y: y + 18 },
      size: { width: 24, height: 18 },
      properties: { shape: 'circle', color: '#f8fafc', opacity: 1 },
      animation: {
        property: 'opacity',
        keyframes: [
          { time: 0, value: 0.32 },
          { time: note.startSeconds + 0.01, value: 1 },
        ],
      },
    },
    {
      id: `ney-stem-${index}`,
      type: 'shape' as const,
      position: { x: x + 6, y: y - 30 },
      size: { width: 2, height: 50 },
      properties: { shape: 'rect', color: '#f8fafc', opacity: 1 },
      animation: {
        property: 'opacity',
        keyframes: [
          { time: 0, value: 0.32 },
          { time: note.startSeconds + 0.01, value: 1 },
        ],
      },
    },
    ...(short
      ? [{
          id: `ney-flag-${index}`,
          type: 'shape' as const,
          position: { x: x + 6, y: y - 30 },
          size: { width: 18, height: 3 },
          properties: { shape: 'rect', color: '#f8fafc', opacity: 1 },
          animation: {
            property: 'opacity',
            keyframes: [
              { time: 0, value: 0.32 },
              { time: note.startSeconds + 0.01, value: 1 },
            ],
          },
        }]
      : []),
  ];
});

const largeSolfegeLayers = neyPhraseNotes.map((note, index) => ({
  id: `ney-solfege-${index}`,
  type: 'text' as const,
  position: { x: 140, y: 470 },
  size: { width: 320, height: 120 },
  properties: {
    text: note.solfege,
    fontSize: 86,
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

const pitchLayers = neyPhraseNotes.map((note, index) => ({
  id: `ney-pitch-${index}`,
  type: 'text' as const,
  position: { x: 920, y: 486 },
  size: { width: 170, height: 60 },
  properties: {
    text: note.pitch,
    fontSize: 32,
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

const markerScenes = neyPhraseNotes.map((note) => ({
  start: note.startSeconds,
  end: note.startSeconds + note.durationSeconds,
  xFormula: `${mapNeyNoteX(note) - 26}`,
  yFormula: `${mapNeyNoteY(note) - 6}`,
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
      size: { width: 460, height: 32 },
      properties: {
        text: 'Ney lesson · first phrase',
        fontSize: 18,
        color: '#94a3b8',
        align: 'left',
        fontWeight: '500',
        opacity: 1,
      },
    },
    {
      id: 'lesson-note-label',
      type: 'text',
      position: { x: 140, y: 438 },
      size: { width: 260, height: 28 },
      properties: {
        text: 'active solfège',
        fontSize: 14,
        color: '#67d7ff',
        align: 'left',
        fontWeight: '700',
        opacity: 1,
      },
    },
    {
      id: 'lesson-pitch-label',
      type: 'text',
      position: { x: 920, y: 448 },
      size: { width: 180, height: 28 },
      properties: {
        text: 'pitch',
        fontSize: 14,
        color: '#67d7ff',
        align: 'left',
        fontWeight: '700',
        opacity: 1,
      },
    },
    ...staffLayers,
    ...noteLayers,
    ...largeSolfegeLayers,
    ...pitchLayers,
    {
      id: 'ney-marker',
      type: 'shape',
      position: { x: mapNeyNoteX(neyPhraseNotes[0]) - 26, y: mapNeyNoteY(neyPhraseNotes[0]) - 6 },
      size: { width: 52, height: 52 },
      properties: {
        shape: 'circle',
        color: '#67d7ff',
        opacity: 0.16,
        motionScenes: markerScenes,
      },
      animation: {
        property: 'opacity',
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.12, value: 0.16 },
        ],
      },
    },
  ],
};
