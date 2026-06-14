// Pure layout logic for the `telemetry-track` layer type. No canvas, no DOM —
// so it is unit-testable in isolation and the renderer's drawTelemetryTrack
// stays a thin painter over the geometry this returns.
//
// A telemetry-track renders one lane per meeting participant across a shared
// time axis (the full meeting duration). Each lane has a `present` base span
// plus `speaking` / `muted` / `videoOff` state spans overlaid on top. The
// animatable `progress` (0..1) maps to a meeting-time play-head: only the
// portion of each span up to the head is drawn, the span under the head is the
// "active" state (highlighted), and the head advances as progress animates.

export type TelemetrySegType = 'present' | 'speaking' | 'muted' | 'videoOff';

export interface TelemetrySegment {
  type: TelemetrySegType;
  startMs: number;
  endMs: number;
}

export interface TelemetryParticipant {
  pid: string;
  name: string;
  host?: boolean;
  talkPct?: number;
  segments: TelemetrySegment[];
}

export interface TelemetryTrackProps {
  meetingDurationMs: number;
  participants: TelemetryParticipant[];
  laneHeight?: number;
  laneGap?: number;
  cornerRadius?: number;
  labelWidth?: number;
  statWidth?: number;
  colors?: Partial<Record<TelemetrySegType, string>>;
}

export interface Geom { x: number; y: number; width: number; height: number; }

export interface LaidSegment {
  type: TelemetrySegType;
  x: number;
  w: number;
  color: string;
  active: boolean;   // play-head is inside this span (non-present only)
  clipped: boolean;  // span extends past the play-head (still in progress)
}

export interface LaidLane {
  name: string;
  host: boolean;
  talkPct?: number;
  trackY: number;
  height: number;
  segments: LaidSegment[];  // present spans first, then overlays
}

export interface TrackLayout {
  trackX: number;
  trackW: number;
  playheadX: number;
  meetingTimeMs: number;
  laneHeight: number;
  cornerRadius: number;
  labelWidth: number;
  statWidth: number;
  lanes: LaidLane[];
}

export const DEFAULT_TELEMETRY_COLORS: Record<TelemetrySegType, string> = {
  present: '#D3D1C7',
  speaking: '#1D9E75',
  muted: '#EF9F27',
  videoOff: '#888780',
};

const SEG_ORDER: Record<TelemetrySegType, number> = { present: 0, speaking: 1, muted: 1, videoOff: 1 };

/**
 * Resolve the on-canvas geometry for a telemetry-track at a given progress.
 * `progress` is clamped 0..1; 0 = nothing revealed yet, 1 = whole meeting shown.
 */
export function layoutTelemetryTrack(props: TelemetryTrackProps, geom: Geom, progress: number): TrackLayout {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 1));
  const durationMs = Math.max(1, props.meetingDurationMs || 1);

  const labelWidth = props.labelWidth ?? 90;
  const statWidth = props.statWidth ?? 64;
  const laneHeight = props.laneHeight ?? 22;
  const laneGap = props.laneGap ?? 12;
  const cornerRadius = props.cornerRadius ?? 4;
  const colors = { ...DEFAULT_TELEMETRY_COLORS, ...(props.colors ?? {}) };

  const trackX = geom.x + labelWidth;
  const trackW = Math.max(1, geom.width - labelWidth - statWidth);
  const meetingTimeMs = clamped * durationMs;
  const playheadX = trackX + clamped * trackW;
  const msToX = (ms: number) => trackX + (Math.max(0, Math.min(durationMs, ms)) / durationMs) * trackW;

  const lanes: LaidLane[] = (props.participants ?? []).map((p, i) => {
    const trackY = geom.y + i * (laneHeight + laneGap);
    const segments: LaidSegment[] = (p.segments ?? [])
      .filter((s) => s && s.startMs < meetingTimeMs && s.endMs > s.startMs)
      .map((s) => {
        const visEnd = Math.min(s.endMs, meetingTimeMs); // clip the in-progress span at the play-head
        const x = msToX(s.startMs);
        const xEnd = msToX(visEnd);
        // Consistent with the reveal filter (startMs < meetingTimeMs): the span
        // is "active" while the play-head is inside it. present is never active.
        const active = s.type !== 'present' && meetingTimeMs < s.endMs;
        return {
          type: s.type,
          x,
          w: Math.max(0, xEnd - x),
          color: colors[s.type] ?? DEFAULT_TELEMETRY_COLORS[s.type],
          active,
          clipped: visEnd < s.endMs,
        };
      })
      // present (base) first so overlays paint on top, otherwise stable order
      .sort((a, b) => SEG_ORDER[a.type] - SEG_ORDER[b.type]);

    return { name: p.name, host: !!p.host, talkPct: p.talkPct, trackY, height: laneHeight, segments };
  });

  return { trackX, trackW, playheadX, meetingTimeMs, laneHeight, cornerRadius, labelWidth, statWidth, lanes };
}
