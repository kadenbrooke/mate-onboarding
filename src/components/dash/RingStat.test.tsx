import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RingStat } from './RingStat';

const segments = [
  { key: 'a', label: 'ALPHA', value: 30, display: '30', color: '#111' },
  { key: 'b', label: 'BETA', value: 70, display: '70', color: '#222' },
];

function setup(extra = {}) {
  return render(
    <RingStat
      idPrefix="t"
      segments={segments}
      center={{ label: 'TOTAL', display: '100', color: '#333' }}
      ariaLabel="test ring"
      {...extra}
    />,
  );
}

describe('RingStat', () => {
  it('renders one arc per segment', () => {
    setup();
    expect(screen.getByTestId('t-seg-a')).toBeInTheDocument();
    expect(screen.getByTestId('t-seg-b')).toBeInTheDocument();
  });

  it('shows every segment value in an always-visible legend (no interaction)', () => {
    setup();
    expect(screen.getByTestId('t-legend-a').textContent).toContain('ALPHA');
    expect(screen.getByTestId('t-legend-a').textContent).toContain('30');
    expect(screen.getByTestId('t-legend-b').textContent).toContain('BETA');
    expect(screen.getByTestId('t-legend-b').textContent).toContain('70');
  });

  it('rests on the provided center', () => {
    setup();
    expect(screen.getByTestId('t-center').textContent).toBe('100');
  });

  it('center-swaps to a segment on hover and returns to rest on leave', () => {
    const { container } = setup();
    fireEvent.mouseEnter(screen.getByTestId('t-seg-a'));
    expect(screen.getByTestId('t-center').textContent).toBe('30');
    fireEvent.mouseLeave(container.firstChild as Element);
    expect(screen.getByTestId('t-center').textContent).toBe('100');
  });

  it('center-swaps from the legend row too, and re-tap returns to rest', () => {
    setup();
    fireEvent.click(screen.getByTestId('t-legend-b'));
    expect(screen.getByTestId('t-center').textContent).toBe('70');
    fireEvent.click(screen.getByTestId('t-legend-b'));
    expect(screen.getByTestId('t-center').textContent).toBe('100');
  });

  it('renders a focused segment sub-line when provided', () => {
    render(
      <RingStat
        idPrefix="s"
        segments={[
          { key: 'x', label: 'X', value: 1, display: '1', color: '#111', sub: 'the sub' },
        ]}
        center={{ label: 'REST', display: '0', color: '#333' }}
        ariaLabel="sub ring"
      />,
    );
    fireEvent.click(screen.getByTestId('s-seg-x'));
    expect(screen.getByTestId('s-center-sub').textContent).toBe('the sub');
  });

  it('all-zero segments -> zero-length arcs, no NaN', () => {
    const { container } = render(
      <RingStat
        idPrefix="z"
        segments={[
          { key: 'a', label: 'A', value: 0, display: '0', color: '#111' },
          { key: 'b', label: 'B', value: 0, display: '0', color: '#222' },
        ]}
        center={{ label: 'ZERO', display: '0', color: '#333' }}
        ariaLabel="zero ring"
      />,
    );
    const [aDash] = (screen.getByTestId('z-seg-a').getAttribute('stroke-dasharray') ?? '').split(' ');
    expect(Number(aDash)).toBe(0);
    container.querySelectorAll('circle').forEach(c => {
      expect(c.getAttribute('stroke-dasharray') ?? '').not.toContain('NaN');
    });
  });
});
