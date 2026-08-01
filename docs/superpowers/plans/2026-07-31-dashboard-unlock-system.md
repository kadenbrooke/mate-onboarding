# Dashboard Unlock System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock dashboard zones the client has not yet supplied data for, showing a red MISSING INFO card that names what is missing and where possible offers the action that fixes it.

**Architecture:** Lock state is derived at render time by one pure module from signals already on the session row. `SectionCard` gains a `locked` prop and renders a `MissingInfo` body instead of its children when set. No new table, no new status column.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest + @testing-library/react, Supabase JS.

---

## Before starting

**Merge PR #1 and PR #2 first, then rebase this branch onto main.**

PR #1 rewrites large parts of `DashboardView.tsx` (movable cards, mobile nav, zone composition) and PR #2 touches `theme.ts`. This plan modifies both files. Starting before those land guarantees conflicts in exactly the files being changed here.

```bash
git checkout main && git pull
git checkout feat/dashboard-unlock-system
git rebase main
npm test   # expect green before writing any new code
```

## Two decisions the founder must confirm before Task 3

These are recorded so implementation does not silently invent them.

**1. Two CTAs have no destination.** No settings surface exists anywhere in the app. `grep -rl "agent_enabled\|operator_phone" src/app src/components` returns only an API route. So "Turn on assistant" and "Add phone number" have nowhere to point.

This plan routes both to `/dash/{sessionId}/assistant`, a real page where the client can ask and the team flips the flag. This is honest: the button goes somewhere real and the request reaches a human. The alternative, building a settings surface, is a larger scope and is not in this plan.

**2. Google connect is a scaffold.** `src/app/api/connect/google/route.ts` says: "SCAFFOLD ONLY. Google Business Profile API access requires Google approval we do NOT have." So a client can complete the Google OAuth flow and still see an empty Reputation zone.

Calendar is unaffected. If Reputation should not offer a connect button until GBP access exists, change its entry in `ZONE_LOCK_COPY` (Task 1) to the secondary "Contact us" treatment that Ad performance uses. Everything else in this plan is unchanged by that choice.

## File structure

| File | Responsibility | Status |
| --- | --- | --- |
| `src/lib/dash/locks.ts` | Pure gate evaluation and lock copy. No React, no Supabase. | create |
| `src/lib/dash/locks.test.ts` | Unit tests for every gate, both states. | create |
| `src/components/dash/MissingInfo.tsx` | The red MISSING INFO card body. Presentational only. | create |
| `src/components/dash/MissingInfo.test.tsx` | Renders copy and CTA. | create |
| `src/components/dash/Card.tsx` | `SectionCard` gains `locked`; swaps children for `MissingInfo`. | modify |
| `src/components/dash/Card.test.tsx` | Asserts children are absent from the tree when locked. | create |
| `src/components/dash/SetupChecklist.tsx` | Replaces `setupStub`. Lists gated zones and their state. | create |
| `src/components/dash/SetupChecklist.test.tsx` | Count correctness, no response-time metric. | create |
| `src/components/dash/DashboardView.tsx` | Accepts `locks`, passes to each `SectionCard`, swaps in checklist. | modify |
| `src/components/dash/types.ts` | `DashData` gains lock inputs. | modify |
| `src/app/dash/[sessionId]/page.tsx` | Selects the three gate columns, computes locks. | modify |
| `scripts/seed-demo-leads.mjs` | `--locked` flag for the walkthrough demo session. | modify |

**Simplification versus the spec:** the spec proposed an `adMetricsCount` input. `page.tsx` already computes `ads`, which is `null` when no `ad_metrics` rows exist for the session (`page.tsx:107`). The gate uses `adsPresent: data.ads !== null`, so no additional query is needed.

**Correction to the spec:** the spec says the per-card theme star is hidden while locked. `SectionCard` has no star; the star lives on the inner `Card` component. Because a locked `SectionCard` never renders its children, the inner cards and their stars never mount. This requires no code.

---

### Task 1: Lock evaluation module

**Files:**
- Create: `src/lib/dash/locks.ts`
- Test: `src/lib/dash/locks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { zoneLocks, ALWAYS_LIVE_ZONES, GATED_ZONES } from './locks';

const ALL_CONNECTED = {
  sessionId: 's1',
  collected: { google_connected: true },
  agentEnabled: true,
  operatorPhone: '+18015551234',
  adsPresent: true,
};
const NOTHING_CONNECTED = {
  sessionId: 's1',
  collected: null,
  agentEnabled: false,
  operatorPhone: null,
  adsPresent: false,
};

describe('zoneLocks', () => {
  it('never locks the always-live zones, even with nothing connected', () => {
    const locks = zoneLocks(NOTHING_CONNECTED);
    for (const id of ALWAYS_LIVE_ZONES) {
      expect(locks[id]).toBeNull();
    }
  });

  it('locks every gated zone when nothing is connected', () => {
    const locks = zoneLocks(NOTHING_CONNECTED);
    for (const id of GATED_ZONES) {
      expect(locks[id], `${id} should be locked`).not.toBeNull();
    }
  });

  it('unlocks every zone when everything is connected', () => {
    const locks = zoneLocks(ALL_CONNECTED);
    expect(Object.values(locks).every((v) => v === null)).toBe(true);
  });

  it('unlocks calendar and reputation together on google_connected', () => {
    const locks = zoneLocks({ ...NOTHING_CONNECTED, collected: { google_connected: true } });
    expect(locks['zone-calendar']).toBeNull();
    expect(locks['zone-reputation']).toBeNull();
    expect(locks['zone-followup']).not.toBeNull();
  });

  it('treats a non-true google_connected value as not connected', () => {
    for (const value of [false, 'true', 1, null, undefined]) {
      const locks = zoneLocks({ ...NOTHING_CONNECTED, collected: { google_connected: value } });
      expect(locks['zone-calendar'], `google_connected=${String(value)}`).not.toBeNull();
    }
  });

  it('treats a blank operator phone as not set', () => {
    for (const value of ['', '   ', null]) {
      const locks = zoneLocks({ ...NOTHING_CONNECTED, operatorPhone: value });
      expect(locks['zone-operations']).not.toBeNull();
    }
  });

  it('unlocks ads on data presence, not on any client action', () => {
    const locks = zoneLocks({ ...NOTHING_CONNECTED, adsPresent: true });
    expect(locks['zone-ads']).toBeNull();
  });

  it('gives ads a secondary cta and the others a primary cta', () => {
    const locks = zoneLocks(NOTHING_CONNECTED);
    expect(locks['zone-ads']?.cta?.secondary).toBe(true);
    expect(locks['zone-calendar']?.cta?.secondary).toBeFalsy();
  });

  it('builds session-scoped cta links', () => {
    const locks = zoneLocks({ ...NOTHING_CONNECTED, sessionId: 'abc-123' });
    expect(locks['zone-calendar']?.cta?.href).toBe('/api/connect/google?sessionId=abc-123');
    expect(locks['zone-followup']?.cta?.href).toBe('/dash/abc-123/assistant');
  });

  it('uses no em dashes in any client-facing copy', () => {
    const locks = zoneLocks(NOTHING_CONNECTED);
    for (const lock of Object.values(locks)) {
      if (lock) expect(lock.reason).not.toContain('—');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/dash/locks.test.ts`
Expected: FAIL, "Failed to resolve import './locks'"

- [ ] **Step 3: Write the implementation**

```ts
// Lock evaluation for dashboard zones.
//
// A zone is locked when the client has not yet supplied what it needs. State is
// derived at render time from signals already on the session row: there is no
// lock table and no status column to keep in sync.
//
// Pure by design (no React, no Supabase) so it is unit testable in isolation,
// matching the convention in src/lib/portal/capabilities.ts.

export type ZoneCta = {
  label: string;
  href: string;
  /** Secondary treatment: the client cannot self-serve this one. */
  secondary?: boolean;
};

export type ZoneLock = {
  reason: string;
  cta?: ZoneCta;
};

/** Zones that derive purely from client_leads and need no connection. */
export const ALWAYS_LIVE_ZONES = [
  'zone-leadflow',
  'zone-speed',
  'zone-pipeline',
  'zone-journey',
] as const;

/** Zones that gate on a signal. */
export const GATED_ZONES = [
  'zone-calendar',
  'zone-reputation',
  'zone-followup',
  'zone-operations',
  'zone-ads',
] as const;

export type ZoneId = (typeof ALWAYS_LIVE_ZONES)[number] | (typeof GATED_ZONES)[number];

export type LockInput = {
  sessionId: string;
  collected: Record<string, unknown> | null;
  agentEnabled: boolean;
  operatorPhone: string | null;
  /** True when ad_metrics rows exist for this session. */
  adsPresent: boolean;
};

/** Human labels, used by the setup checklist. */
export const ZONE_LABELS: Record<ZoneId, string> = {
  'zone-leadflow': 'Lead flow',
  'zone-speed': 'Speed to lead',
  'zone-pipeline': 'Pipeline',
  'zone-journey': 'Lead journey',
  'zone-calendar': 'Calendar',
  'zone-reputation': 'Reputation',
  'zone-followup': 'Follow-up engine',
  'zone-operations': 'Operations',
  'zone-ads': 'Ad performance',
};

export function zoneLocks(input: LockInput): Record<ZoneId, ZoneLock | null> {
  const googleConnected = input.collected?.google_connected === true;
  const phoneSet = (input.operatorPhone ?? '').trim().length > 0;

  const googleCta: ZoneCta = {
    label: 'Connect Google',
    href: `/api/connect/google?sessionId=${input.sessionId}`,
  };
  // No settings surface exists for these two, so the action is to ask in the
  // assistant chat, which is a real page and reaches a real person.
  const askCta = (label: string): ZoneCta => ({
    label,
    href: `/dash/${input.sessionId}/assistant`,
  });

  const locks: Record<ZoneId, ZoneLock | null> = {
    'zone-leadflow': null,
    'zone-speed': null,
    'zone-pipeline': null,
    'zone-journey': null,

    'zone-calendar': googleConnected ? null : {
      reason: 'We need your Google account to show your booked jobs.',
      cta: googleCta,
    },
    'zone-reputation': googleConnected ? null : {
      reason: 'We need your Google account to pull your reviews.',
      cta: googleCta,
    },
    'zone-followup': input.agentEnabled ? null : {
      reason: 'Your assistant is switched off, so nothing is following up yet.',
      cta: askCta('Turn on assistant'),
    },
    'zone-operations': phoneSet ? null : {
      reason: 'Add the phone number a real person should be reached at.',
      cta: askCta('Add phone number'),
    },
    // Meta config is a single set of env vars shared by the whole app, so there
    // is no per-session account for a client to connect. This zone unlocks when
    // ad data lands, and offers contact rather than a control that does nothing.
    'zone-ads': input.adsPresent ? null : {
      reason: "Your ad account isn't linked yet. We do this for you, so get in touch and we'll wire it up.",
      cta: { label: 'Contact us', href: `/dash/${input.sessionId}/assistant`, secondary: true },
    },
  };

  return locks;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/dash/locks.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/dash/locks.ts src/lib/dash/locks.test.ts
git commit -m "feat: derive dashboard zone lock state from session signals"
```

---

### Task 2: The MISSING INFO card

**Files:**
- Create: `src/components/dash/MissingInfo.tsx`
- Test: `src/components/dash/MissingInfo.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MissingInfo } from './MissingInfo';

describe('MissingInfo', () => {
  it('shows the alert, the zone name and the reason', () => {
    render(<MissingInfo zoneLabel="Calendar" reason="We need your Google account." />);
    expect(screen.getByText(/MISSING/)).toBeTruthy();
    expect(screen.getByText('Calendar')).toBeTruthy();
    expect(screen.getByText('We need your Google account.')).toBeTruthy();
  });

  it('renders the cta as a link to its href', () => {
    render(
      <MissingInfo
        zoneLabel="Calendar"
        reason="r"
        cta={{ label: 'Connect Google', href: '/api/connect/google?sessionId=s1' }}
      />,
    );
    const link = screen.getByRole('link', { name: 'Connect Google' });
    expect(link.getAttribute('href')).toBe('/api/connect/google?sessionId=s1');
  });

  it('renders no link when there is no cta', () => {
    render(<MissingInfo zoneLabel="Calendar" reason="r" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders no numbers, so a locked zone cannot be mistaken for real data', () => {
    const { container } = render(<MissingInfo zoneLabel="Ad performance" reason="Not linked yet." />);
    expect(container.textContent).not.toMatch(/\d/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/dash/MissingInfo.test.tsx`
Expected: FAIL, "Failed to resolve import './MissingInfo'"

- [ ] **Step 3: Write the implementation**

```tsx
'use client';
import { FONT_BODY, TEXT_DARK, TEXT_MUTED, BG_SECTION, SCORE_RED } from '@/lib/theme';
import type { ZoneCta } from '@/lib/dash/locks';

/**
 * The body a locked SectionCard renders instead of its children.
 *
 * Deliberately shows no numbers of any kind: no blurred sample figures, no
 * skeleton bars implying data. This dashboard had an incident where real and
 * synthetic leads were indistinguishable, and the lock state will not
 * reintroduce that ambiguity in visual form.
 *
 * SCORE_RED is the existing lead-score alert red, reused here rather than
 * adding a colour to the palette.
 */
export function MissingInfo({ zoneLabel, reason, cta }: {
  zoneLabel: string;
  reason: string;
  cta?: ZoneCta;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', textAlign: 'center', gap: 9,
      padding: '22px 6px', minHeight: 180,
    }}>
      <div style={{
        fontFamily: FONT_BODY, fontWeight: 800, fontSize: 31, lineHeight: 0.95,
        letterSpacing: -0.5, color: SCORE_RED,
      }}>
        MISSING<br />INFO
      </div>
      <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: TEXT_DARK }}>
        {zoneLabel}
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: TEXT_MUTED, maxWidth: '31ch' }}>
        {reason}
      </div>
      {cta && (
        <a
          href={cta.href}
          style={{
            marginTop: 6, borderRadius: 999, padding: '10px 20px',
            fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, textDecoration: 'none',
            ...(cta.secondary
              ? { background: 'transparent', color: TEXT_MUTED, border: `1px solid ${SCORE_RED}33` }
              : { background: TEXT_DARK, color: BG_SECTION, border: '1px solid transparent' }),
          }}
        >
          {cta.label}
        </a>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/dash/MissingInfo.test.tsx`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/components/dash/MissingInfo.tsx src/components/dash/MissingInfo.test.tsx
git commit -m "feat: add the MISSING INFO card for locked zones"
```

---

### Task 3: SectionCard renders the lock instead of its children

**Files:**
- Modify: `src/components/dash/Card.tsx:16-41`
- Test: `src/components/dash/Card.test.tsx`

- [ ] **Step 1: Write the failing test**

The third test is the one that matters. A lock implemented as a CSS overlay would still ship the real numbers to the browser, one devtools inspection away from the client.

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionCard } from './Card';

describe('SectionCard', () => {
  it('renders children when not locked', () => {
    render(<SectionCard title="Calendar"><p>real content</p></SectionCard>);
    expect(screen.getByText('real content')).toBeTruthy();
  });

  it('renders the MISSING INFO body when locked', () => {
    render(
      <SectionCard title="Calendar" locked={{ zoneLabel: 'Calendar', reason: 'Connect Google first.' }}>
        <p>real content</p>
      </SectionCard>,
    );
    expect(screen.getByText(/MISSING/)).toBeTruthy();
    expect(screen.getByText('Connect Google first.')).toBeTruthy();
  });

  it('does not render children into the tree at all when locked', () => {
    const { container } = render(
      <SectionCard title="Calendar" locked={{ zoneLabel: 'Calendar', reason: 'r' }}>
        <p data-testid="secret">$18,400 recovered</p>
      </SectionCard>,
    );
    expect(screen.queryByTestId('secret')).toBeNull();
    expect(container.textContent).not.toContain('18,400');
  });

  it('keeps its id so the icon rail can still scroll to a locked zone', () => {
    const { container } = render(
      <SectionCard id="zone-calendar" title="Calendar" locked={{ zoneLabel: 'Calendar', reason: 'r' }}>
        <p>x</p>
      </SectionCard>,
    );
    expect(container.querySelector('#zone-calendar')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/dash/Card.test.tsx`
Expected: FAIL, TypeScript rejects the unknown `locked` prop and the MISSING INFO text is not found.

- [ ] **Step 3: Modify SectionCard**

In `src/components/dash/Card.tsx`, add `SCORE_RED` to the **existing** `@/lib/theme` import rather than adding a second one, which would fail lint:

```tsx
import {
  FONT_BODY, BG_SECTION, BORDER_SOFT, CARD_SHADOW, TEXT_MUTED,
  CARD_BG, CARD_FG, CARD_MUTED, SCORE_RED,
} from '@/lib/theme';
```

Then add the two new imports:

```tsx
import { MissingInfo } from './MissingInfo';
import type { ZoneCta } from '@/lib/dash/locks';
```

Replace the whole `SectionCard` function (lines 16 to 41) with:

```tsx
export type SectionLock = {
  zoneLabel: string;
  reason: string;
  cta?: ZoneCta;
};

export function SectionCard({ title, right, children, style, id, locked }: {
  title?: string; right?: ReactNode; children: ReactNode; style?: React.CSSProperties; id?: string;
  locked?: SectionLock;
}) {
  // Variant C: the whole card is tinted so the zone reads as an alert, not as a
  // card that happens to contain red text.
  const lockedStyle: React.CSSProperties = locked ? {
    background: `color-mix(in srgb, ${SCORE_RED} 7%, ${BG_SECTION})`,
    border: `1px solid color-mix(in srgb, ${SCORE_RED} 28%, transparent)`,
  } : {};

  return (
    <section id={id} style={{
      background: BG_SECTION, borderRadius: 24, padding: 16,
      border: `1px solid ${BORDER_SOFT}`, scrollMarginTop: 12,
      ...lockedStyle, ...style,
    }}>
      {(title || right) && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          padding: '2px 6px 10px',
        }}>
          {title
            ? <h2 style={{
                margin: 0, fontSize: 11, letterSpacing: 2, color: TEXT_MUTED,
                fontFamily: FONT_BODY, fontWeight: 600, textTransform: 'uppercase',
              }}>{title}</h2>
            : <span />}
          {locked ? null : right}
        </div>
      )}
      {/* Children are not rendered at all when locked, never merely hidden: a
          CSS overlay would still ship the real numbers to the browser. */}
      {locked
        ? <MissingInfo zoneLabel={locked.zoneLabel} reason={locked.reason} cta={locked.cta} />
        : children}
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/dash/Card.test.tsx`
Expected: PASS, 4 tests

- [ ] **Step 5: Run the whole suite to confirm nothing regressed**

Run: `npm test`
Expected: every previously passing test still passes. `SectionCard` callers that pass no `locked` prop are unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/components/dash/Card.tsx src/components/dash/Card.test.tsx
git commit -m "feat: SectionCard withholds children and shows MISSING INFO when locked"
```

---

### Task 4: Setup checklist replaces the stub

**Files:**
- Create: `src/components/dash/SetupChecklist.tsx`
- Test: `src/components/dash/SetupChecklist.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SetupChecklist } from './SetupChecklist';
import { zoneLocks } from '@/lib/dash/locks';

const NOTHING = zoneLocks({
  sessionId: 's1', collected: null, agentEnabled: false, operatorPhone: null, adsPresent: false,
});
const EVERYTHING = zoneLocks({
  sessionId: 's1', collected: { google_connected: true }, agentEnabled: true,
  operatorPhone: '+18015551234', adsPresent: true,
});

describe('SetupChecklist', () => {
  it('counts connected items out of the gated total', () => {
    render(<SetupChecklist locks={NOTHING} />);
    expect(screen.getByText('0 of 5 connected')).toBeTruthy();
  });

  it('counts everything when all gates pass', () => {
    render(<SetupChecklist locks={EVERYTHING} />);
    expect(screen.getByText('5 of 5 connected')).toBeTruthy();
  });

  it('lists every gated zone by name', () => {
    render(<SetupChecklist locks={NOTHING} />);
    for (const label of ['Calendar', 'Reputation', 'Follow-up engine', 'Operations', 'Ad performance']) {
      expect(screen.getByText(label), label).toBeTruthy();
    }
  });

  it('never shows a response-time or speed metric', () => {
    const { container } = render(<SetupChecklist locks={NOTHING} />);
    expect(container.textContent).not.toMatch(/response|speed|streak|seconds/i);
  });

  it('shows no percentage or score, because setup is not a performance metric', () => {
    const { container } = render(<SetupChecklist locks={NOTHING} />);
    expect(container.textContent).not.toContain('%');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/dash/SetupChecklist.test.tsx`
Expected: FAIL, "Failed to resolve import './SetupChecklist'"

- [ ] **Step 3: Write the implementation**

```tsx
'use client';
import { Card } from './Card';
import { CheckCircle, Circle } from '@phosphor-icons/react';
import { FONT_BODY, CARD_FG, CARD_MUTED, FREE_GREEN, SCORE_RED } from '@/lib/theme';
import { GATED_ZONES, ZONE_LABELS, type ZoneId, type ZoneLock } from '@/lib/dash/locks';

/**
 * Setup completion, not performance.
 *
 * Shows a count of connected items. Never a percentage, score, streak, or any
 * speed measure: gamification in this product is limited to leads in and leads
 * closed, and response speed is excluded outright because the owner does not
 * control it.
 */
export function SetupChecklist({ locks }: { locks: Record<ZoneId, ZoneLock | null> }) {
  const connected = GATED_ZONES.filter((id) => locks[id] === null).length;

  return (
    <Card label="SETUP">
      <div style={{
        fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700,
        color: CARD_FG, marginTop: 8,
      }}>
        {connected} of {GATED_ZONES.length} connected
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 11 }}>
        {GATED_ZONES.map((id) => {
          const lock = locks[id];
          const done = lock === null;
          return (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {done
                ? <CheckCircle size={16} weight="fill" color={FREE_GREEN} />
                : <Circle size={16} weight="bold" color={SCORE_RED} />}
              <span style={{
                fontFamily: FONT_BODY, fontSize: 12,
                color: done ? CARD_MUTED : CARD_FG,
              }}>
                {ZONE_LABELS[id]}
              </span>
              {!done && lock?.cta && (
                <a href={lock.cta.href} style={{
                  marginLeft: 'auto', fontFamily: FONT_BODY, fontSize: 11.5,
                  fontWeight: 600, color: CARD_FG, textDecoration: 'underline',
                }}>
                  {lock.cta.label}
                </a>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/dash/SetupChecklist.test.tsx`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/components/dash/SetupChecklist.tsx src/components/dash/SetupChecklist.test.tsx
git commit -m "feat: add the setup checklist that replaces the placeholder stub"
```

---

### Task 5: Wire locks through the page into the dashboard

**Files:**
- Modify: `src/app/dash/[sessionId]/page.tsx:16-20` and the `DashboardView` call at the end
- Modify: `src/components/dash/DashboardView.tsx:55-56, 84, 170` and each gated `SectionCard`

- [ ] **Step 1: Select the gate columns in `page.tsx`**

The session select currently fetches three columns. Replace it with:

```tsx
  const { data: session } = await supabase
    .from('onboarding_sessions')
    .select('id, mate_name, contact_id, collected, agent_enabled, operator_phone')
    .eq('id', sessionId)
    .single();
  if (!session) notFound();
```

- [ ] **Step 2: Compute locks after `ads` is derived**

`ads` is computed around line 107 and is `null` when the session has no `ad_metrics` rows, so it doubles as the ads gate. Add directly below it:

```tsx
  const locks = zoneLocks({
    sessionId,
    collected: (session.collected ?? null) as Record<string, unknown> | null,
    agentEnabled: session.agent_enabled === true,
    operatorPhone: (session.operator_phone ?? null) as string | null,
    adsPresent: ads !== null,
  });
```

And add the import at the top of the file:

```tsx
import { zoneLocks } from '@/lib/dash/locks';
```

- [ ] **Step 3: Pass locks to the view**

```tsx
    <DashboardView
      session={{ id: session.id, mate_name: session.mate_name }}
      leads={(leadsResult.data ?? []) as Lead[]}
      data={data}
      locks={locks}
    />
```

- [ ] **Step 4: Accept locks in `DashboardView`**

Change the signature at line 55:

```tsx
export function DashboardView({ session, leads, data, locks }: {
  session: { id: string; mate_name?: string | null }; leads: Lead[]; data: DashData;
  locks: Record<ZoneId, ZoneLock | null>;
}) {
```

Add the import. Note `zoneLocks` itself is **not** imported here: the view receives computed locks and never evaluates them, which keeps the gate logic in one place.

```tsx
import { ZONE_LABELS, type ZoneId, type ZoneLock } from '@/lib/dash/locks';
```

Define a helper immediately after the signature, so each zone reads the same way:

```tsx
  // Turns a lock into the prop SectionCard expects, or undefined when unlocked.
  const lockFor = (id: ZoneId) => {
    const lock = locks[id];
    return lock ? { zoneLabel: ZONE_LABELS[id], reason: lock.reason, cta: lock.cta } : undefined;
  };
```

- [ ] **Step 5: Pass the lock to each gated SectionCard**

For every `SectionCard` in `movableCards` whose `id` is one of `zone-calendar`, `zone-reputation`, `zone-followup`, `zone-operations`, `zone-ads`, add `locked={lockFor('<that id>')}`. For example:

```tsx
    { id: 'zone-calendar', x: 0, y: 0, w: 12, node: (
      <SectionCard title="Calendar" locked={lockFor('zone-calendar')}>
        <BookedCalendar appointments={data.appointments} showLabel={false} wide />
      </SectionCard>
    ) },
```

Leave the four always-live zones untouched. `lockFor` returns `undefined` for them anyway, but not passing the prop keeps the intent explicit.

- [ ] **Step 6: Swap the stub for the checklist**

Replace line 84:

```tsx
  const setupStub = <Card label="SETUP"><Dim note="unlock checklist arrives with the next build" /></Card>;
```

with:

```tsx
  const setupCard = <SetupChecklist locks={locks} />;
```

Update the mobile card entry at line 170 from `setupStub` to `setupCard`. Add the import:

```tsx
import { SetupChecklist } from './SetupChecklist';
```

Then remove the `Dim` import if nothing else in the file uses it. Check with:

```bash
grep -n "Dim" src/components/dash/DashboardView.tsx
```

- [ ] **Step 7: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean. Existing `DashboardView` tests will fail to compile because they do not pass the new required `locks` prop.

- [ ] **Step 8: Fix the existing DashboardView tests**

In `src/components/dash/DashboardView.test.tsx`, add an all-unlocked fixture and pass it wherever `DashboardView` is rendered, so existing assertions keep testing the unlocked dashboard:

```tsx
import { zoneLocks } from '@/lib/dash/locks';

const UNLOCKED = zoneLocks({
  sessionId: 's1', collected: { google_connected: true }, agentEnabled: true,
  operatorPhone: '+18015551234', adsPresent: true,
});
// then add locks={UNLOCKED} to every <DashboardView ... /> in this file
```

- [ ] **Step 9: Run the full suite again**

Run: `npx tsc --noEmit && npm test`
Expected: PASS, everything green.

- [ ] **Step 10: Commit**

```bash
git add src/app/dash/\[sessionId\]/page.tsx src/components/dash/DashboardView.tsx src/components/dash/DashboardView.test.tsx
git commit -m "feat: lock gated zones on the dashboard and show the setup checklist"
```

---

### Task 6: Seeder flag for the locked walkthrough demo

**Files:**
- Modify: `scripts/seed-demo-leads.mjs:1-14`

- [ ] **Step 1: Update the usage header and argument parsing**

Replace lines 1 to 14 with:

```js
// scripts/seed-demo-leads.mjs
// Seeds ~40 believable leads for one session so every widget renders.
// Usage: node scripts/seed-demo-leads.mjs <session_id> [--skip-leads] [--locked]
//   --skip-leads  skip the client_leads insert (avoids piling duplicate leads onto an existing demo session)
//   --locked      reset the session so every gated zone is locked, for walking
//                 the unlock flow end to end. Leads are still seeded, so the
//                 always-live zones render and the contrast is visible.
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const sessionId = args.find(a => !a.startsWith('--'));
const skipLeads = args.includes('--skip-leads');
const locked = args.includes('--locked');

if (!sessionId) {
  console.error('usage: node scripts/seed-demo-leads.mjs <session_id> [--skip-leads] [--locked]');
  process.exit(1);
}

// The session id must always be passed explicitly. A default would let a reset
// land on the prospect-facing demo, which is the same class of mistake that put
// a client's real leads on a public page.
if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
  console.error(`refusing to run: "${sessionId}" is not a session uuid`);
  process.exit(1);
}
```

- [ ] **Step 2: Add the locking reset, immediately after the supabase client is created**

```js
if (locked) {
  const { error } = await supabase
    .from('onboarding_sessions')
    .update({ collected: {}, agent_enabled: false, operator_phone: null })
    .eq('id', sessionId);
  if (error) { console.error('lock reset failed', error); process.exit(1); }

  const { error: adErr } = await supabase.from('ad_metrics').delete().eq('session_id', sessionId);
  if (adErr) { console.error('ad_metrics clear failed', adErr); process.exit(1); }

  console.log(`locked session ${sessionId}: google/agent/phone cleared, ad_metrics removed`);
}
```

- [ ] **Step 3: Verify the guard rejects a non-uuid**

Run: `node scripts/seed-demo-leads.mjs not-a-uuid --locked`
Expected: `refusing to run: "not-a-uuid" is not a session uuid`, exit code 1, no network call.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-demo-leads.mjs
git commit -m "feat: add --locked to the seeder for the unlock walkthrough demo"
```

---

### Task 7: Create the locked walkthrough demo session

**Files:** none. This is a one-time data operation.

- [ ] **Step 1: Create the session row**

Run, with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` exported:

```bash
curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/onboarding_sessions" \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"mate_name":"Locked Walkthrough Demo","website_url":"https://auto-mate.business","is_demo":true,"status":"complete","step":"ready","agent_enabled":false,"collected":{}}' \
  | python3 -m json.tool
```

Record the returned `id`.

- [ ] **Step 2: Seed leads and force the locked state**

```bash
node scripts/seed-demo-leads.mjs <new-session-id> --locked
```

- [ ] **Step 3: Verify every gate**

```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/onboarding_sessions?id=eq.<new-session-id>&select=collected,agent_enabled,operator_phone,is_demo" \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY"
```

Expected: `collected` is `{}`, `agent_enabled` false, `operator_phone` null, `is_demo` true.

- [ ] **Step 4: Confirm the prospect demo was not touched**

```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/onboarding_sessions?id=eq.b7573135-d4ec-43bb-bf33-a1d365739784&select=collected,agent_enabled" \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY"
```

Expected: unchanged, still carrying its picked brand and settings.

---

### Task 8: Manual verification

- [ ] **Step 1: Start the dev server**

```bash
npm run dev -- -p 3210
```

- [ ] **Step 2: Walk the locked demo**

Open `http://localhost:3210/dash/<new-session-id>`.

Expected: Lead flow, Speed to lead, Pipeline, and Lead journey all render real seeded content. Calendar, Reputation, Follow-up engine, Operations, and Ad performance each show a red-tinted MISSING INFO card. Ad performance shows the secondary "Contact us"; the rest show a primary button. The setup card reads "0 of 5 connected".

- [ ] **Step 3: Confirm the lock is not cosmetic**

View source on the locked page and search for a figure that only appears in a locked zone, such as an appointment customer name.

Expected: absent from the HTML entirely. If it is present but visually covered, Task 3 regressed.

- [ ] **Step 4: Unlock one gate and confirm the change**

```bash
curl -s -X PATCH "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/onboarding_sessions?id=eq.<new-session-id>" \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent_enabled":true}'
```

Reload. Expected: Follow-up engine now renders its real content, the setup card reads "1 of 5 connected", and the other four stay locked.

- [ ] **Step 5: Confirm the existing demo is unaffected**

Open `http://localhost:3210/dash/b7573135-d4ec-43bb-bf33-a1d365739784`.

Expected: unchanged from before this work. Locked zones appear only where that session genuinely lacks a connection.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: compiles clean.

- [ ] **Step 7: Open the pull request**

```bash
git push -u origin feat/dashboard-unlock-system
gh pr create --repo kadenbrooke/mate-onboarding --fill
```
