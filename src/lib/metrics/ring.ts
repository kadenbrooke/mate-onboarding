export type RingInput = { key: string; value: number };
export type RingSegment = { key: string; value: number; dash: number; offset: number };

/**
 * SVG circle stroke-dasharray math for segmented rings (rotate(-90) group
 * assumed for a full ring, rotate(180) for a 180-degree gauge).
 *
 * `sweepDeg` is how much of the circle the segments fill: 360 for a donut,
 * 180 for a semicircle gauge. The dash lengths scale to that arc, so the same
 * math drives both shapes.
 */
export function ringSegments(inputs: RingInput[], radius: number, gapDeg = 0, sweepDeg = 360): RingSegment[] {
  const circumference = 2 * Math.PI * radius;
  const span = (Math.max(0, Math.min(360, sweepDeg)) / 360) * circumference;
  const total = inputs.reduce((a, s) => a + s.value, 0);
  const gapLen = (gapDeg / 360) * circumference;
  let cursor = 0;
  return inputs.map((s) => {
    const raw = total === 0 ? 0 : (s.value / total) * span;
    const dash = Math.max(0, raw - gapLen);
    const seg = { key: s.key, value: s.value, dash, offset: cursor === 0 ? 0 : -cursor };
    cursor += raw;
    return seg;
  });
}

/** Track length for a ring of the given sweep, for the background circle's dasharray. */
export function ringTrackDash(radius: number, sweepDeg = 360): number {
  const circumference = 2 * Math.PI * radius;
  return (Math.max(0, Math.min(360, sweepDeg)) / 360) * circumference;
}
