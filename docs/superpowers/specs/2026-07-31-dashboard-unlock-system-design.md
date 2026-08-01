# Dashboard Unlock System

Status: approved design, not yet implemented
Date: 2026-07-31

## Problem

The client dashboard renders all nine zones unconditionally. A client who has
connected nothing sees the same layout as one who has connected everything,
except the zones are silently empty. An empty zone is indistinguishable from a
broken one, and nothing tells the client that the emptiness is their to fix.

`DashboardView.tsx` currently carries a placeholder for this:

```
const setupStub = <Card label="SETUP"><Dim note="unlock checklist arrives with the next build" /></Card>;
```

This spec replaces that stub.

## Approach

A zone is locked when the client has not yet supplied what it needs. Lock state
is **derived** at render time from signals that already exist on the session
row. No new table, no new status column, nothing to keep in sync.

Locked zones show a loud red MISSING INFO card naming what is missing and, where
the client can act, a button that starts the connection.

## Zone gates

Nine zones. Four need nothing and are always live. Four gate on a real signal.
One is a special case.

| Zone id | Gate | Signal |
| --- | --- | --- |
| `zone-leadflow` | none | always live |
| `zone-speed` | none | always live |
| `zone-pipeline` | none | always live, derived from leads |
| `zone-journey` | none | always live, derived from leads |
| `zone-calendar` | Google connected | `collected.google_connected === true` |
| `zone-reputation` | Google connected | `collected.google_connected === true` |
| `zone-followup` | agent turned on | `agent_enabled === true` |
| `zone-operations` | operator phone set | `operator_phone` non-empty |
| `zone-ads` | ad data present | `ad_metrics` rows exist for the session |

The four always-live zones derive entirely from `client_leads`, which arrives
from every channel. They are the dashboard's floor: a client who has connected
nothing still sees their leads.

### Why Ad performance is gated on data, not on a connection

The other four gated zones unlock when the client does something. Ad performance
cannot, because there is no per-session Meta configuration to do it with.
`META_JC_AD_ACCOUNT` and `META_JC_PAGE_TOKEN` are single environment variables:
the whole Meta integration is single-tenant, wired to one client at the
environment level.

So the Ad zone unlocks when `ad_metrics` rows appear for the session, and its
MISSING INFO card carries no primary button. It shows a secondary "Contact us"
action instead: "Your ad account isn't linked yet. We do this for you, so get in
touch and we'll wire it up."

This is deliberate. A "Connect Meta" button that silently does nothing would be
the same class of error as the mislabeled `DEFAULT_JC_SESSION` constant that put
83 real leads on a public demo page: an interface asserting something the
plumbing does not do. Making Meta config per-session is the real fix and is
scoped as follow-up work, not part of this build.

## The MISSING INFO card

A locked zone renders **no invented numbers**: no blurred sample figures, no
skeleton bars implying data. This dashboard just had a real incident caused by
real and synthetic data being indistinguishable; locked zones will not
reintroduce that ambiguity in visual form.

The card contains, top to bottom:

1. `MISSING INFO`, stacked on two lines, ~31px, weight 800, in alert red. The
   loudest element on the dashboard, by intent.
2. The zone name.
3. One line naming exactly what is missing, in the client's language:
   "We need your Google account to show your booked jobs."
4. A primary action button, when one exists.

The card itself is red-tinted rather than neutral, so the whole zone reads as an
alert and not merely as a card containing red text:

```
background:   color-mix(in srgb, {red} 7%,  {BG_SECTION})
border-color: color-mix(in srgb, {red} 28%, transparent)
```

A fully red card was considered and rejected: four of them at once turns a
half-configured dashboard into a wall of red, which punishes a client who is
mid-setup rather than directing them.

The alert red is `SCORE_RED` (`#c0392b`), which already exists in `theme.ts`
driving the lead-score traffic light. No new color enters the palette. Reuse the
existing token; do not inline the hex.

### Copy

| Zone | Reason line | Action |
| --- | --- | --- |
| Calendar | We need your Google account to show your booked jobs. | Connect Google |
| Reputation | We need your Google account to pull your reviews. | Connect Google |
| Follow-up engine | Your assistant is switched off, so nothing is following up yet. | Turn on assistant |
| Operations | Add the phone number a real person should be reached at. | Add phone number |
| Ad performance | Your ad account isn't linked yet. We do this for you, so get in touch and we'll wire it up. | Contact us (secondary) |

The in-app character is "your assistant", never the product name. Mate is the
name of the app, not of the agent inside it.

## Where the lock lives

`SectionCard` in `src/components/dash/Card.tsx` wraps every zone. It is the
single choke point, so the overlay goes there rather than in nine call sites.

`SectionCard` takes a new optional prop:

```ts
locked?: { reason: string; cta?: { label: string; href: string } }
```

When `locked` is present, `SectionCard` renders the MISSING INFO card in place of
its children. Children are not rendered at all, not hidden with CSS. A locked
zone must not ship data to the browser, or the lock is decorative and the
numbers are one devtools inspection away.

Zone components themselves stay unchanged. They never learn they are lockable.

### Interaction with existing dashboard behavior

- **Movable grid:** locked cards keep their grid position and stay draggable, so
  a client's saved layout survives unlocking. Only the card's interior is
  replaced.
- **Per-card theme star:** hidden while locked. There is nothing to theme, and
  the star competes with the alert.
- **Icon rail:** locked zones remain in `RAIL_SECTIONS` and stay scrollable to.
  Hiding them would make the dashboard appear to shrink as a client discovers
  how little they have connected.

## Gate evaluation

One pure module, `src/lib/dash/locks.ts`:

```ts
export type ZoneLock = { reason: string; cta?: { label: string; href: string } }

export function zoneLocks(input: {
  collected: Record<string, unknown> | null
  agentEnabled: boolean
  operatorPhone: string | null
  adMetricsCount: number
}): Record<string, ZoneLock | null>
```

Pure, no Supabase import, unit tested in isolation, matching the existing
convention in `src/lib/portal/capabilities.ts`. `page.tsx` gathers the four
inputs it already fetches and passes the result into `DashboardView`.

## Setup checklist

The `setupStub` card is replaced by a real checklist listing every gated zone
with its state and action. It shows progress as a count of connected items, not
as a score, streak, or percentage.

This is setup completion, not performance. It must never be framed as
competition, and it must never incorporate response time. Gamification in this
product is limited to leads in and leads closed; response speed is explicitly
excluded because the owner does not control it.

## The locked walkthrough demo

A second `is_demo` session, seeded fully locked, so the unlock flow can be walked
end to end without touching the prospect-facing demo at `b7573135`.

- New session row: `is_demo = true`, `agent_enabled = false`, `operator_phone`
  null, `collected.google_connected` absent, no `ad_metrics` rows.
- Leads are still seeded, so the four always-live zones render real-looking
  content and the contrast between live and locked is visible.
- `scripts/seed-demo-leads.mjs` gains a `--locked` flag that creates or resets a
  session into exactly this state.

Resetting the walkthrough demo must never touch `b7573135`. The seeder takes an
explicit session id and will refuse to run against a session it was not given.

## Testing

- `locks.ts`: unit tests per zone, both states, plus the all-locked and
  all-unlocked boundaries.
- `SectionCard`: renders MISSING INFO when locked; renders children when not;
  **asserts children are absent from the tree when locked**, which is the test
  that keeps the lock from decaying into a CSS overlay.
- Checklist: correct count, and no response-time metric present.
- Existing dashboard tests must pass unchanged. An unlocked dashboard is
  unaffected by this work.

## Out of scope

- Per-session Meta configuration. Tracked separately; it is what would let the
  Ad zone become genuinely self-serve.
- Any plan-tier or billing gate. Locks here mean "you have not connected this",
  never "you have not paid for this".
- Changes to the unlock actions themselves. This spec gates on existing signals
  and links to existing flows; it does not build new connection surfaces.
