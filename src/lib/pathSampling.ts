import type { PathAnchor } from './api';

/**
 * Sample a path defined by anchors at parameter `t` in [0, 1].
 *
 * Linear-t segment allocation: each segment gets equal share of t — for
 * N anchors (N-1 segments, or N if closed), segment i covers
 * t ∈ [i/segCount, (i+1)/segCount]. Speed along the path therefore varies
 * with segment length (longer segments → faster). Arc-length-parameterised
 * sampling (constant velocity along the whole curve) is a future
 * improvement: precompute cumulative arc lengths and remap t.
 *
 * Segment rendering:
 *   - If anchors[i].out exists AND anchors[i+1].in exists → cubic Bezier
 *     using both handles. Use bezierAt() with absolute control points.
 *   - Otherwise → straight line interpolation.
 *
 * Closed paths: segCount = anchors.length (wraps the last anchor back to
 * the first). Open paths: segCount = anchors.length - 1.
 */
export function samplePath(anchors: PathAnchor[], t: number, closed = false): { x: number; y: number } {
  if (anchors.length === 0) return { x: 0, y: 0 };
  if (anchors.length === 1) return { x: anchors[0].x, y: anchors[0].y };

  const segCount = closed ? anchors.length : anchors.length - 1;
  if (segCount <= 0) return { x: anchors[0].x, y: anchors[0].y };

  const clamped = Math.max(0, Math.min(1, t));
  const totalSeg = clamped * segCount;
  let segIdx = Math.floor(totalSeg);
  if (segIdx >= segCount) segIdx = segCount - 1;
  const localT = totalSeg - segIdx;

  const a = anchors[segIdx];
  const b = anchors[(segIdx + 1) % anchors.length];

  if (a.out && b.in) {
    return bezierAt(
      a.x, a.y,
      a.x + a.out.x, a.y + a.out.y,
      b.x + b.in.x, b.y + b.in.y,
      b.x, b.y,
      localT,
    );
  }

  // Linear interpolation
  return {
    x: a.x + localT * (b.x - a.x),
    y: a.y + localT * (b.y - a.y),
  };
}

/**
 * Cubic Bezier point at parameter t in [0, 1]. P0 / P3 are the segment
 * endpoints; P1 / P2 are the absolute control points (NOT handle offsets —
 * caller adds the anchor's position to its handle offset before calling).
 */
export function bezierAt(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  t: number,
): { x: number; y: number } {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: mt3 * x0 + 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t3 * x3,
    y: mt3 * y0 + 3 * mt2 * t * y1 + 3 * mt * t2 * y2 + t3 * y3,
  };
}
