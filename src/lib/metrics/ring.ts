export type RingInput = { key: string; value: number };
export type RingSegment = { key: string; value: number; dash: number; offset: number };

/** SVG circle stroke-dasharray math for segmented rings (rotate(-90) group assumed). */
export function ringSegments(inputs: RingInput[], radius: number, gapDeg = 0): RingSegment[] {
  const circumference = 2 * Math.PI * radius;
  const total = inputs.reduce((a, s) => a + s.value, 0);
  const gapLen = (gapDeg / 360) * circumference;
  let cursor = 0;
  return inputs.map((s) => {
    const raw = total === 0 ? 0 : (s.value / total) * circumference;
    const dash = Math.max(0, raw - gapLen);
    const seg = { key: s.key, value: s.value, dash, offset: cursor === 0 ? 0 : -cursor };
    cursor += raw;
    return seg;
  });
}
