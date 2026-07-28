type ServiceStat = { service: string; count: number; share: number; avgCents: number };
export type Wedge = ServiceStat & { startDeg: number; endDeg: number; radius: number; path: string };

const rad = (deg: number) => ((deg - 90) * Math.PI) / 180; // 0deg = 12 o'clock

export function wheelWedges(stats: ServiceStat[], opts: { minR: number; maxR: number }): Wedge[] {
  const avgs = stats.map(s => s.avgCents);
  const lo = Math.min(...avgs), hi = Math.max(...avgs);
  // Angles normalize over the stats actually passed in. Callers slice to a
  // top-N, so the upstream `share` field (share of ALL leads) can sum below 1
  // and used to leave a phantom gap; wedge angle must be exactly proportional
  // to count within the wheel: count / totalCount * 360.
  const totalCount = stats.reduce((a, s) => a + s.count, 0);
  let cursor = 0;
  return stats.map(s => {
    const share = totalCount === 0 ? 0 : s.count / totalCount;
    const startDeg = cursor;
    const endDeg = cursor + share * 360;
    cursor = endDeg;
    const t = hi === lo ? 1 : (s.avgCents - lo) / (hi - lo);
    const radius = opts.minR + t * (opts.maxR - opts.minR);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    const x1 = radius * Math.cos(rad(startDeg)), y1 = radius * Math.sin(rad(startDeg));
    const x2 = radius * Math.cos(rad(endDeg)), y2 = radius * Math.sin(rad(endDeg));
    const path = endDeg - startDeg >= 360
      ? `M0,0 m0,${-radius} a${radius},${radius} 0 1,1 0,${2 * radius} a${radius},${radius} 0 1,1 0,${-2 * radius}`
      : `M0,0 L${x1},${y1} A${radius},${radius} 0 ${large},1 ${x2},${y2} Z`;
    return { ...s, startDeg, endDeg, radius, path };
  });
}
