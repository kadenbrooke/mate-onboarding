# Mate — Onboarding

Standalone, client-facing onboarding app. Replaces static intake forms with a
conversational concierge agent ("{Business} Mate") that researches the client's
website, walks the owner through setup, collects everything needed to build their
agent, auto-provisions the no-gate pieces, and ends with an in-browser sandbox of
their own agent.

**White-label:** this is a client surface — no Auto Mate branding is baked in.
Theming is derived per-tenant in a later task. Do not add Auto Mate logos here.

## Stack
Next 16 (App Router) · React 19 · Tailwind v4 · Phosphor · self-hosted Syne ·
`@supabase/ssr` · Vercel AI SDK (`ai`) · `zod` · Vitest.

## Auth model (scaffold)
- Per-user login (Supabase Auth email/password) against the business Supabase
  project (`jeqnvdlfybpmbovywknz`).
- `src/app/(app)/layout.tsx` enforces a per-tenant membership gate against the
  `portal_access` table (`email`, `client_slug`). The slug is a placeholder
  (`"mate"`) until a later task derives it from the onboarding session.
- `src/proxy.ts` (Next 16 middleware) requires a session on gated routes.

## Structure
- `src/app/layout.tsx` — root layout (fonts, theme tokens).
- `src/app/login/` — email/password sign-in.
- `src/app/(app)/` — auth + membership-gated area. `page.tsx` is a placeholder
  ("Mate — onboarding coming online") until the concierge flow lands.
- `src/lib/supabase/{client,server,middleware}.ts` — SSR three-file client.
- `src/app/globals.css` — Tailwind v4 + self-hosted Syne (`ss04`) + theme tokens.

## Env
See `.env.example`. Copy to `.env.local` and fill values. Never commit real
secrets; `.env*` is gitignored.

## Dev
```bash
cp .env.example .env.local   # fill values
npm install
npm run dev                  # http://localhost:3000
```

## Test
```bash
npm test                     # vitest run — unit tests in src/**/*.test.ts
```

## Deploy
Own Vercel project (client-facing; not amos). Set the same env vars there.

## Demo go-live (Instant First Responder Demo)

The demo spans the Next app (`/api/demo/start`, public + unauthed) and two Supabase
Edge Functions (`demo-voice`, `demo-sms`). Do NOT flip it live until every item
below is done. Env vars are in `.env.example` under the demo section.

### Required before public traffic
1. **`TELNYX_PUBLIC_KEY` MUST be set on the edge runtime.** Signature verification
   fails CLOSED in production: with the key unset, every webhook is rejected
   (`verify.ts`, `isProd()` via `DENO_DEPLOYMENT_ID` / `DEMO_ENV=production`). This
   is deliberate — an unset key must never silently accept forged webhooks. The
   local dev-skip (no key => accept) applies ONLY when not in a deployed context.
2. **Telnyx Messaging env:** `TELNYX_API_KEY`, `DEMO_TELNYX_NUMBER` (the one shared
   demo number), optional `TELNYX_MESSAGING_PROFILE_ID`. Unset => sends no-op.
3. **Model key:** `GEMINI_API_KEY` (default model `google/gemini-3-flash-preview`),
   `PORTKEY_BASE_URL`.
4. **Migrations applied:** `0002_demo_sessions.sql` and
   `0003_demo_sms_conversations.sql` (creates `demo_sms_conversations` with the
   composite PK `(from_number, business)` — the upsert conflict target — plus the
   atomic `demo_counters` table + `demo_counter_bump()` RPC, and extends the pg_cron
   TTL sweep to hard-delete inbound texts after 7 days).

### Cost / abuse controls (all env-overridable)
- **Start route (`/api/demo/start`):** per-phone/day + global daily breaker. The
  hard caps are ATOMIC in the DB (`demo_counter_bump`, scopes `demo_start_phone` /
  `demo_start_global`) so a concurrent burst can't overshoot; the app-side
  `checkGuard` is a cheap fast-path only. `DEMO_MAX_PER_PHONE_PER_DAY`,
  `DEMO_MAX_PER_DAY`.
- **Inbound SMS qualify loop (`demo-sms`):** per-sender daily reply cap
  (`DEMO_SMS_MAX_REPLIES_PER_NUMBER_PER_DAY`, default 20) + a global outbound-SMS
  breaker (`DEMO_SMS_MAX_PER_DAY`, default 500). At the per-sender cap it sends one
  canned hand-off line then goes silent for the day.
- **Code fallback (`demo-sms` Path A):** 6-digit code (1,000,000 space) +
  per-sender attempt throttle (`DEMO_CODE_MAX_ATTEMPTS_PER_NUMBER_PER_DAY`,
  default 10). Wrong codes count as attempts and never fall through to a model call.
- **SSRF:** `/api/demo/start` scrapes a user-supplied URL through `fetchSiteGuarded`
  (scheme allowlist, DNS resolve + private/loopback/link-local reject, 2MB body
  cap). The shared `fetchSite` used by the authed research route is left untouched.

### Ops — Portkey SPOF failover (honest version)
Portkey on KVM2 is a single point of failure for the demo's model calls. The
repo-wide `LLM_PORTKEY_BYPASS=1` flag is a **NO-OP for this demo** as configured:
the default model is Gemini and the edge client only has a Portkey path (no
provider-native bypass). Real failover options when Portkey/KVM2 is down:
1. **Repoint the gateway:** set `PORTKEY_BASE_URL` to a healthy Portkey instance, OR
2. **Switch provider through a still-reachable Portkey:** set `DEMO_REPLY_MODEL` to
   an OpenAI id (e.g. `openai/gpt-4o-mini`) and ensure `OPENAI_API_KEY` is set, then
   (if you also wire a native bypass later) `LLM_PORTKEY_BYPASS=1`.
Until a provider-native bypass is added to the edge Portkey client, treat option 1
(repoint) as the primary failover lever.
