import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDashLayout } from './useDashLayout';
import type { DashLayout } from '@/lib/dash/layout';

const DEFAULT: DashLayout = [
  { i: 'a', x: 0, y: 0, w: 6, h: 4 },
  { i: 'b', x: 6, y: 0, w: 6, h: 4 },
];
const KEY = 'mate:dash:layout:v1:sess1';

describe('useDashLayout', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns the default layout when nothing is stored', () => {
    const { result } = renderHook(() => useDashLayout('sess1', DEFAULT));
    expect(result.current.layout).toEqual(DEFAULT);
    expect(result.current.isCustomized).toBe(false);
  });

  it('hydrates from a stored layout', () => {
    const stored: DashLayout = [{ i: 'a', x: 6, y: 0, w: 6, h: 8 }];
    window.localStorage.setItem(KEY, JSON.stringify(stored));
    const { result } = renderHook(() => useDashLayout('sess1', DEFAULT));
    expect(result.current.layout).toEqual(stored);
    expect(result.current.isCustomized).toBe(true);
  });

  it('setLayout persists and marks customized', () => {
    const { result } = renderHook(() => useDashLayout('sess1', DEFAULT));
    const next: DashLayout = [{ i: 'a', x: 0, y: 0, w: 12, h: 6 }];
    act(() => result.current.setLayout(next));
    expect(result.current.layout).toEqual(next);
    expect(result.current.isCustomized).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual(next);
  });

  it('reset clears storage and restores the default', () => {
    window.localStorage.setItem(KEY, JSON.stringify([{ i: 'a', x: 1, y: 1, w: 3, h: 3 }]));
    const { result } = renderHook(() => useDashLayout('sess1', DEFAULT));
    act(() => result.current.reset());
    expect(result.current.layout).toEqual(DEFAULT);
    expect(result.current.isCustomized).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('ignores corrupt stored JSON and falls back to default', () => {
    window.localStorage.setItem(KEY, '{ not json');
    const { result } = renderHook(() => useDashLayout('sess1', DEFAULT));
    expect(result.current.layout).toEqual(DEFAULT);
    expect(result.current.isCustomized).toBe(false);
  });
});
