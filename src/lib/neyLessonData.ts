export type FluteLessonNote = {
  readonly id: string;
  readonly measure: number;
  readonly beat: number;
  readonly absoluteBeat: number;
  readonly startSeconds: number;
  readonly durationSeconds: number;
  readonly durationBeats: number;
  readonly pitch: string;
  readonly solfege: string;
  readonly noteType: string;
  readonly x: number;
  readonly y: number;
};

export const DAGLAR_ILE_TASLAR_ILE_FLUTE_LESSON = {
  title: 'Dağlar İle Taşlar İle',
  subtitle: 'Flute lesson · first phrase',
  source: 'P1 (Flöte) from daglar-ile-taslar-ile-kutbi-dede.mxl',
  tempo: 65,
  notes: [
    { id: 'P1-m1-n0', measure: 1, beat: 1, absoluteBeat: 1, startSeconds: 0, durationSeconds: 0.9231, durationBeats: 1, pitch: 'E4', solfege: 'mi', noteType: 'quarter', x: 99.27, y: -40 },
    { id: 'P1-m1-n1', measure: 1, beat: 2, absoluteBeat: 2, startSeconds: 0.9231, durationSeconds: 0.9231, durationBeats: 1, pitch: 'A4', solfege: 'la', noteType: 'quarter', x: 137.46, y: -25 },
    { id: 'P1-m1-n2', measure: 1, beat: 3, absoluteBeat: 3, startSeconds: 1.8462, durationSeconds: 0.2308, durationBeats: 0.25, pitch: 'B4', solfege: 'si', noteType: '16th', x: 175.65, y: -20 },
    { id: 'P1-m1-n3', measure: 1, beat: 3.25, absoluteBeat: 3.25, startSeconds: 2.0769, durationSeconds: 0.2308, durationBeats: 0.25, pitch: 'A4', solfege: 'la', noteType: '16th', x: 193.65, y: -25 },
    { id: 'P1-m1-n4', measure: 1, beat: 3.5, absoluteBeat: 3.5, startSeconds: 2.3077, durationSeconds: 0.2308, durationBeats: 0.25, pitch: 'A4', solfege: 'la', noteType: '16th', x: 211.65, y: -25 },
    { id: 'P1-m1-n5', measure: 1, beat: 3.75, absoluteBeat: 3.75, startSeconds: 2.5385, durationSeconds: 0.2308, durationBeats: 0.25, pitch: 'G#4', solfege: 'sol#', noteType: '16th', x: 229.65, y: -30 },
    { id: 'P1-m1-n6', measure: 1, beat: 4, absoluteBeat: 4, startSeconds: 2.7692, durationSeconds: 0.9231, durationBeats: 1, pitch: 'A4', solfege: 'la', noteType: 'quarter', x: 247.65, y: -25 },
    { id: 'P1-m2-n0', measure: 2, beat: 1, absoluteBeat: 5, startSeconds: 3.6923, durationSeconds: 0.4615, durationBeats: 0.5, pitch: 'G#4', solfege: 'sol#', noteType: 'eighth', x: 12.5, y: -30 },
    { id: 'P1-m2-n1', measure: 2, beat: 1.5, absoluteBeat: 5.5, startSeconds: 4.1538, durationSeconds: 0.4615, durationBeats: 0.5, pitch: 'A4', solfege: 'la', noteType: 'eighth', x: 37.96, y: -25 },
    { id: 'P1-m2-n2', measure: 2, beat: 2, absoluteBeat: 6, startSeconds: 4.6154, durationSeconds: 0.4615, durationBeats: 0.5, pitch: 'B4', solfege: 'si', noteType: 'eighth', x: 63.42, y: -20 },
    { id: 'P1-m2-n3', measure: 2, beat: 2.5, absoluteBeat: 6.5, startSeconds: 5.0769, durationSeconds: 0.4615, durationBeats: 0.5, pitch: 'C5', solfege: 'do', noteType: 'eighth', x: 88.88, y: -15 },
    { id: 'P1-m2-n4', measure: 2, beat: 3, absoluteBeat: 7, startSeconds: 5.5385, durationSeconds: 0.2308, durationBeats: 0.25, pitch: 'B4', solfege: 'si', noteType: '16th', x: 114.34, y: -20 },
    { id: 'P1-m2-n5', measure: 2, beat: 3.25, absoluteBeat: 7.25, startSeconds: 5.7692, durationSeconds: 0.2308, durationBeats: 0.25, pitch: 'A4', solfege: 'la', noteType: '16th', x: 132.34, y: -25 },
    { id: 'P1-m2-n6', measure: 2, beat: 3.5, absoluteBeat: 7.5, startSeconds: 6, durationSeconds: 0.2308, durationBeats: 0.25, pitch: 'A4', solfege: 'la', noteType: '16th', x: 150.34, y: -25 },
    { id: 'P1-m2-n7', measure: 2, beat: 3.75, absoluteBeat: 7.75, startSeconds: 6.2308, durationSeconds: 0.2308, durationBeats: 0.25, pitch: 'G#4', solfege: 'sol#', noteType: '16th', x: 168.34, y: -30 },
    { id: 'P1-m2-n8', measure: 2, beat: 4, absoluteBeat: 8, startSeconds: 6.4615, durationSeconds: 0.9231, durationBeats: 1, pitch: 'A4', solfege: 'la', noteType: 'quarter', x: 186.34, y: -25 },
  ] as const satisfies readonly FluteLessonNote[],
} as const;
