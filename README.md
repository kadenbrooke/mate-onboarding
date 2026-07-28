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

The demo spans the Next app (`/api/demo/start`, public + unauthed) and three Supabase
Edge Functions (`demo-voice`, `demo-sms`, `demo-transcribe`). Do NOT flip it live
until every item below is done. Env vars are in `.env.example` under the demo section.

### Required before public traffic
1. **`TELNYX_PUBLIC_KEY` MUST be set on the edge runtime.** Signature verification
   fails CLOSED in production: with the key unset, every webhook is rejected
   (`verify.ts`, `isProd()` via `DENO_DEPLOYMENT_ID` / `DEMO_ENV=production`). This
   is deliberate — an unset key must never silently accept forged webhooks. The
   local dev-skip (no key => accept) applies ONLY when not in a deployed context.
2. **Telnyx Messaging env:** `TELNYX_API_KEY`, `DEMO_TELNYX_NUMBER` (the one shared
   demo number), optional `TELNYX_MESSAGING_PROFILE_ID`. Unset => sends no-op.
3. **Model key:** `GEMINI_API_KEY` (default model `google/gemini-2.5-flash`),
   `PORTKEY_BASE_URL`. Also `DEMO_REPLY_MAX_TOKENS` (default 800): the budget must
   cover Gemini's HIDDEN reasoning tokens PLUS the visible SMS. A tight budget (e.g.
   300) gets fully consumed by reasoning and the reply truncates mid-sentence
   (`finish_reason:"length"`). The client also requests `reasoning_effort:"none"`.
4. **Voicemail flow tokens (Flow A):** `DEMO_TRANSCRIBE_TOKEN` (auth for the
   transcribe callback; fails CLOSED when unset in prod) and `DEMO_TEXTBACK_DELAY_
   SECONDS` (default 30, the no-VM text-back buffer). See "Voicemail + text-back
   buffer" below. `DEMO_FUNCTIONS_BASE` optional (defaults to the edge base).
5. **Migrations applied:** `0002_demo_sessions.sql` and
   `0003_demo_sms_conversations.sql` (creates `demo_sms_conversations` with the
   composite PK `(from_number, business)`, the upsert conflict target, plus the
   atomic `demo_counters` table + `demo_counter_bump()` RPC, and extends the pg_cron
   TTL sweep to hard-delete inbound texts after 7 days). NOTE: the voicemail work
   adds NO migration; the exactly-one-text guard reuses `demo_counter_bump()` with
   scope `text_sent`, key = CallSid, cap = 1.

### Voicemail + text-back buffer (Flow A)
The caller flow, since Flow A:
1. Caller calls the demo number. `demo-voice` returns TeXML that speaks the
   personalized line + a "text us or leave a message" invite, then `<Record>`s the
   caller with transcription on. **No text is sent from the call webhook** (that
   moved out; see the guard below).
2. **VM path (caller leaves a message):** Telnyx transcribes and POSTs the transcript
   to `demo-transcribe`, which crafts a warm SMS that REFERENCES what they said (the
   transcript is sanitized + fenced as untrusted data, then handed to the persona
   model), sends it, and seeds `demo_sms_conversations` with the voicemail turn + the
   sent text so the ongoing SMS agent has context.
3. **No-VM path (hang up at the beep):** `demo-voice`'s `<Record>` `action` callback
   fires with `RecordingDuration` ~0. It sends the generic personalized greeting,
   SCHEDULED via Telnyx `send_at` to land ~`DEMO_TEXTBACK_DELAY_SECONDS` after the
   call (feels like a real callback, not an instant bot). No function stays alive to
   wait; Telnyx does the delaying. `send_at` is honoured to ~1-minute accuracy, so a
   30s buffer lands within the same or next minute.
4. **Early-hangup path (ringing / during the greeting, before the beep):** a caller
   who hangs up before the Record beep reaches NEITHER callback above -> today they
   got NOTHING. `demo-call-status` (the call-lifecycle StatusCallback handler) is the
   SAFETY NET that closes this. The TeXML app's Status Callback URL points at it; on
   call end it DEFERS `DEMO_HANGUP_CATCHALL_DELAY_SECONDS` (default 45), THEN claims
   the one-text slot and sends the generic greeting IF no other path already did. See
   the ordering guarantee below for why the deferral is essential.

**HANGUP CATCH-ALL ORDERING (the hard part).** The StatusCallback fires IMMEDIATELY
at hangup; the referencing transcribe callback arrives ~10-20s LATER (Telnyx has to
transcribe first). So a voicemail-leaver must get the REFERENCING text, never a
generic pre-empt. The catch-all guarantees this by claiming AT FIRE, not at schedule:
it waits `DEMO_HANGUP_CATCHALL_DELAY_SECONDS` (which must exceed transcription latency
AND the no-VM `send_at` buffer), and ONLY THEN calls `claimTextForCall(CallSid)`. By
fire time the referencing VM path (claims at its send time) and the no-VM action path
(claims immediately) have already taken the slot, so the catch-all's claim returns
false and it no-ops. It sends ONLY on a true early hangup where no other path exists.
This is why `DEMO_HANGUP_CATCHALL_DELAY_SECONDS` falls back to 45 (never 0) on a
non-positive value: a 0 delay would race the referencing path and risk a generic
pre-empt. *Residual risk (honest):* the deferral runs in `EdgeRuntime.waitUntil`; if
Supabase recycles the instance before the timer fires, an early-hangup caller gets no
text -- same class as the lost-transcribe-webhook gap, a bit wider (this delay
window). Keep the delay as low as reliably clears the referencing path.

**EXACTLY ONE TEXT PER CALL.** All THREE sending paths -- the VM transcribe callback,
the no-VM Record `action` callback, and the hangup `demo-call-status` catch-all --
call `claimTextForCall(CallSid)` before sending (the initial call webhook still sends
nothing). That is an atomic `demo_counter_bump('text_sent', CallSid, 1)`: the FIRST
path to claim wins and sends; every later path for that call gets `false` and no-ops.
So a call yields exactly one outbound text no matter which path (or several, in a
race) fires. Fails CLOSED (no send) on a missing CallSid or a DB error. The catch-all
claims LAST by design (it defers first) so the referencing text always wins the slot.

**FAILED / EMPTY TRANSCRIPTION IS NEVER SILENCE.** For a real message (duration above
the no-message threshold) the no-VM action path early-returns, so `demo-transcribe`
is the ONLY path that fires. If the transcript comes back `failed` OR empty-after-
sanitize, `demo-transcribe` still `claimTextForCall(CallSid)` and sends the GENERIC
personalized greeting (`fr_config.greeting`, or a hard default for unknown callers)
instead of returning without sending. So a prospect who left a voicemail always gets
at least the generic callback; a USABLE transcript still gets the message-REFERENCING
text. The claim keeps exactly-one-text intact (if the no-VM path somehow also fires,
the claim dedupes). *Residual gap (honest):* a real message whose transcribe callback
never ARRIVES at all (a lost webhook) can't be closed without a timer and is out of
scope; the common `failed`/`empty` cases are covered.

**`<=2s` real message routes to the generic text (accepted tradeoff).** A genuine but
very short message (a single word, "call me back") sits at/below
`NO_MESSAGE_MAX_DURATION_SECONDS` (2s) and is routed to the generic no-VM text rather
than a referencing one. We prefer that fidelity loss over misclassifying beep-then-
hangup jitter as a real message; the 2s threshold stays. Noted in `voicemail.ts`.

**Model-spend is bounded too, not just SMS.** In `demo-transcribe` the model call
(`craftVmReply`) is now gated by a global per-day counter (`vm_model_global`, cap
`DEMO_VM_MODEL_MAX_PER_DAY`, default 500) bumped BEFORE the model call, so forged
CallSids (post token-leak) can't rack up model spend before the SMS breaker is
consulted. Token auth stays the primary gate; this is defense-in-depth. At cap, the
model is skipped and the generic greeting is sent (still one text, still no silence).

**Transcription engine (v1 vs future).** v1 uses Telnyx's built-in
`<Record transcribe="true">` + `transcribeCallback` (zero extra infra). The TeXML
emits BOTH the Telnyx-native `transcription`/`transcriptionCallback` and the
Twilio-compat `transcribe`/`transcribeCallback` attribute pairs, so a naming
mismatch can't silently drop transcription on the live call path.
*Future upgrade (NOT built):* swap to Whisper-on-KVM2 for higher-accuracy, cheaper,
one-vendor transcription. The `<Record>` already produces a `RecordingUrl`; a future
`demo-transcribe` variant would fetch that audio and POST it to the KVM2 Whisper
endpoint (`reference_whisper_kvm2`) instead of relying on Telnyx's transcript, then
craft the SMS from Whisper's text. Everything downstream (craft + one-text guard +
seed) stays the same; only the transcript source changes.

### Deploy (edge functions)
```bash
supabase functions deploy demo-voice demo-transcribe demo-call-status --no-verify-jwt \
  --project-ref jeqnvdlfybpmbovywknz
supabase secrets set DEMO_TRANSCRIBE_TOKEN=<token> DEMO_TEXTBACK_DELAY_SECONDS=30 \
  DEMO_HANGUP_CATCHALL_DELAY_SECONDS=45 \
  --project-ref jeqnvdlfybpmbovywknz
```
`DEMO_VM_MODEL_MAX_PER_DAY` (default 500) caps the VM-reply model call in
`demo-transcribe`; override only if the demo needs a tighter/looser per-day model
budget. It is independent of `DEMO_SMS_MAX_PER_DAY` (the SMS breaker).
The transcribe callback URL is constructed IN the TeXML `demo-voice` emits (from
`SUPABASE_URL` or `DEMO_FUNCTIONS_BASE` + `DEMO_TRANSCRIBE_TOKEN`). No Telnyx
dashboard change is needed to wire it.

### Telnyx: wire the hangup catch-all StatusCallback (REQUIRED for demo-call-status)
Unlike the transcribe callback (constructed in-band in the TeXML), the call-lifecycle
StatusCallback is a TeXML APPLICATION setting, so it needs one dashboard/API change.
Set the TeXML application's **Status Callback URL** to the new handler WITH its `?k=`
token (reuses `DEMO_VOICE_TOKEN`), method POST:
```
https://jeqnvdlfybpmbovywknz.supabase.co/functions/v1/demo-call-status?k=<DEMO_VOICE_TOKEN>
```
TeXML app id: `3005465183788205904`. The StatusCallback is Twilio-compatible and
carries `From` + `CallSid` (the exactly-one-text key) + `CallStatus`
(`completed` | `no-answer` | `busy` | `failed` | `canceled`); `parseCallbackFields`
reads all of these. GET-verify the URL stuck after setting it. If the app already
had a StatusCallback for another purpose, do NOT clobber it -- this demo owns the
whole demo number, so it should be free.

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
