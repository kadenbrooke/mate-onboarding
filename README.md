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
