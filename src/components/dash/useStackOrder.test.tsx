import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStackOrder } from './useStackOrder';

const DEFAULTS = ['a', 'b', 'c'];
const KEY = 'mate:dash:order:v1:s1:mobile-home';

describe('useStackOrder', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns default order when nothing stored', () => {
    const { result } = renderHook(() => useStackOrder('s1', 'mobile-home', DEFAULTS));
    expect(result.current.order).toEqual(DEFAULTS);
    expect(result.current.isCustomized).toBe(false);
  });

  it('hydrates a stored order', () => {
    window.localStorage.setItem(KEY, JSON.stringify(['c', 'a', 'b']));
    const { result } = renderHook(() => useStackOrder('s1', 'mobile-home', DEFAULTS));
    expect(result.current.order).toEqual(['c', 'a', 'b']);
    expect(result.current.isCustomized).toBe(true);
  });

  it('merges stored order with the current card set (drop gone, append new)', () => {
    // stored has an id that no longer exists ('x') and is missing a new one ('c')
    window.localStorage.setItem(KEY, JSON.stringify(['b', 'x', 'a']));
    const { result } = renderHook(() => useStackOrder('s1', 'mobile-home', DEFAULTS));
    expect(result.current.order).toEqual(['b', 'a', 'c']);
  });

  it('setOrder persists and marks customized', () => {
    const { result } = renderHook(() => useStackOrder('s1', 'mobile-home', DEFAULTS));
    act(() => result.current.setOrder(['c', 'b', 'a']));
    expect(result.current.order).toEqual(['c', 'b', 'a']);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual(['c', 'b', 'a']);
  });

  it('reset clears storage and restores defaults', () => {
    window.localStorage.setItem(KEY, JSON.stringify(['c', 'b', 'a']));
    const { result } = renderHook(() => useStackOrder('s1', 'mobile-home', DEFAULTS));
    act(() => result.current.reset());
    expect(result.current.order).toEqual(DEFAULTS);
    expect(result.current.isCustomized).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
