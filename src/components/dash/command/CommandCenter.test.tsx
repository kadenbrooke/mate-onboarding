import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CommandCenter } from './CommandCenter';
import { practiceModel } from '@/test/commandFixture';
import type { CommandModel } from '@/lib/command/commandCenter';

const today = 'Wed, Oct 7';

describe('CommandCenter', () => {
  it('shows the four cards over practice data', () => {
    render(<CommandCenter model={practiceModel()} today={today} demo={false} />);
    for (const t of ['Call now', 'Waiting on you', 'On the books', 'Stuck']) {
      expect(screen.getByRole('heading', { name: new RegExp(t, 'i') })).toBeInTheDocument();
    }
    expect(screen.getAllByText('Dana Whitfield').length).toBeGreaterThan(0);
    expect(screen.getByText('Owes $6,100')).toBeInTheDocument();
    expect(screen.getByText('Quote 26d')).toBeInTheDocument();
    expect(within(screen.getByTestId('wait-count-handed')).getByText('2')).toBeInTheDocument();
  });

  it('never shows the partner revenue share', () => {
    const { container } = render(<CommandCenter model={practiceModel()} today={today} demo={false} />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/15\s*%|basis|partner|share/i);
  });

  it('only links to tel: calls and the pipeline, nothing that sends', () => {
    const { container } = render(<CommandCenter model={practiceModel('s-1')} today={today} demo={false} />);
    const hrefs = [...container.querySelectorAll('a')].map(a => a.getAttribute('href') ?? '');
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h).toMatch(/^(tel:\+1\d{10}|\/dash\/s-1\/pipeline(\?spotlight=[\w-]+)?)$/);
    expect(container.querySelectorAll('form, button')).toHaveLength(0);
    for (const a of screen.getAllByRole('link', { name: 'Call Dana Whitfield' })) expect(a).toHaveAttribute('href', 'tel:+18015550141');
  });

  it('does not dial from the demo dashboard', () => {
    const { container } = render(<CommandCenter model={practiceModel()} today={today} demo />);
    expect(container.querySelectorAll('a[href^="tel:"]')).toHaveLength(0);
    expect(screen.getAllByTestId('call-disabled').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: 'Call Dana Whitfield (off in the demo)' }).length).toBeGreaterThan(0);
  });

  it('lists every lead source in By source, not a top slice', () => {
    const base = practiceModel();
    const sources = Array.from({ length: 7 }, (_, i) => ({ source: `src${i}`, leads: 3, won: 1, collectedCents: (7 - i) * 10_000 }));
    render(<CommandCenter model={{ ...base, books: { ...base.books!, sources } }} today={today} demo={false} />);
    expect(screen.getAllByTestId(/^source-/)).toHaveLength(7);
  });

  it('says so when there is nothing to do', () => {
    const empty: CommandModel = {
      call: [], scored: true, waiting: { rows: [], counts: { handed: 0, replied: 0, new: 0 }, more: 0 },
      stuck: { rows: [], more: 0 }, books: null, pipelineHref: '/dash/s-1/pipeline',
      incomplete: { call: false, waiting: false, stuck: false },
    };
    render(<CommandCenter model={empty} today={today} demo={false} />);
    expect(screen.getByText('Nobody to call')).toBeInTheDocument();
    expect(screen.getByText('All caught up')).toBeInTheDocument();
    expect(screen.getByText('Nothing stuck')).toBeInTheDocument();
    expect(screen.getByText('Not set up yet')).toBeInTheDocument();
  });

  it('says when a card could not show everything, and only on that card', () => {
    const { rerender } = render(<CommandCenter model={practiceModel()} today={today} demo={false} />);
    expect(screen.queryByText('Some not shown')).toBeNull();
    rerender(<CommandCenter model={{ ...practiceModel(), incomplete: { call: false, waiting: false, stuck: true } }} today={today} demo={false} />);
    expect(screen.getByTestId('incomplete-stuck')).toHaveTextContent('Some not shown');
    expect(screen.queryByTestId('incomplete-call')).toBeNull();
  });

  it('says scoring is off rather than claiming nobody is worth a call', () => {
    const model = { ...practiceModel(), call: [], scored: false };
    render(<CommandCenter model={model} today={today} demo={false} />);
    expect(screen.getByText('Scoring not on yet')).toBeInTheDocument();
  });
});
