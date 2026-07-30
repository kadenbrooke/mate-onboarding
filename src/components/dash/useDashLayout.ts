'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  type DashLayout, loadLayout, saveLayout, clearLayout,
} from '@/lib/dash/layout';

/**
 * Client dashboard layout state, persisted per-device in localStorage.
 *
 * SSR-safe: the first render (server + initial client) always returns
 * `defaultLayout`; a stored layout is read in an effect after mount, so server
 * and client markup match. Mirrors the hydration posture of `cardTheme.tsx`.
 *
 * `defaultLayout` must be referentially stable across renders (memoize at the
 * call site) so `reset` and the hydration effect don't thrash.
 */
export function useDashLayout(sessionId: string, defaultLayout: DashLayout) {
  const [layout, setLayoutState] = useState<DashLayout>(defaultLayout);
  const [isCustomized, setIsCustomized] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = loadLayout(sessionId);
    if (stored) {
      setLayoutState(stored);
      setIsCustomized(true);
    } else {
      setLayoutState(defaultLayout);
      setIsCustomized(false);
    }
    setHydrated(true);
  }, [sessionId, defaultLayout]);

  const setLayout = useCallback((next: DashLayout) => {
    setLayoutState(next);
    setIsCustomized(true);
    saveLayout(sessionId, next);
  }, [sessionId]);

  const reset = useCallback(() => {
    clearLayout(sessionId);
    setLayoutState(defaultLayout);
    setIsCustomized(false);
  }, [sessionId, defaultLayout]);

  return { layout, setLayout, reset, isCustomized, hydrated };
}
