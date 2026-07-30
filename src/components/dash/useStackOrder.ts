'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadOrder, saveOrder, clearOrder, mergeOrder,
} from '@/lib/dash/layout';

/**
 * Persisted card order for one mobile stack (tab), per-device.
 *
 * SSR-safe like useDashLayout: the first render returns `defaultIds`; a stored
 * order is read in an effect after mount. `defaultIds` may be a fresh array
 * each render (derived from the card set) — it is stabilised internally by its
 * joined key, so callers need not memoize.
 */
export function useStackOrder(sessionId: string, stackId: string, defaultIds: string[]) {
  const defaultKey = defaultIds.join('|');
  // Stable snapshot of the defaults for effect/callback deps.
  const defaults = useMemo(() => defaultKey.split('|').filter(Boolean), [defaultKey]);

  const [order, setOrderState] = useState<string[]>(defaults);
  const [isCustomized, setIsCustomized] = useState(false);

  useEffect(() => {
    const stored = loadOrder(sessionId, stackId);
    if (stored) {
      setOrderState(mergeOrder(stored, defaults));
      setIsCustomized(true);
    } else {
      setOrderState(defaults);
      setIsCustomized(false);
    }
  }, [sessionId, stackId, defaults]);

  const setOrder = useCallback((ids: string[]) => {
    setOrderState(ids);
    setIsCustomized(true);
    saveOrder(sessionId, stackId, ids);
  }, [sessionId, stackId]);

  const reset = useCallback(() => {
    clearOrder(sessionId, stackId);
    setOrderState(defaults);
    setIsCustomized(false);
  }, [sessionId, stackId, defaults]);

  return { order, setOrder, reset, isCustomized };
}
