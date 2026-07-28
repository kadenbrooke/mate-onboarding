'use client';
import { useEffect, useRef, useState } from 'react';

/** Cubic ease-out count-up used by the hero stat numbers. */
export function useCountUp(target: number, ms = 1500) {
  const [value, setValue] = useState(0);
  const raf = useRef<number>(0);
  useEffect(() => {
    if (typeof requestAnimationFrame === 'undefined') {
      setValue(target);
      return;
    }
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setValue(target * (1 - Math.pow(1 - p, 3))); // cubic ease-out
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return value;
}
