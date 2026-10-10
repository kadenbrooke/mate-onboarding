# J&C dashboard on its own data project: deploy plan

Status: **plan only, nothing below has been run.** Every step that creates a Vercel
project, sets an env var, deploys, applies a migration, or changes DNS, auth, n8n or
cal.com is founder-gated. It pairs with the amos runbook
`departments/customer-success/clients/jc-asphalt-paving/own-db/RUNBOOK.md`
(blocker 2, consumer row 10). That runbook owns the data copy and the evening switch;
this file owns the Mate side of it.

## What the code does (branch `polly/jc-dashboard-copy`)

| Piece | Where |
|---|---|
| Which project holds data, which tenants a deployment serves | `src/lib/supabase/tenancy.ts` |
| Data client vs control (logins + CRM) client | `src/lib/supabase/service.ts` (`createServiceClient` = data, `createControlServiceClient` = logins/CRM) |
| Proxy: dedicated deployments deny by default; moved sessions forward (pages) or 410 (APIs) | `src/lib/supabase/tenant-proxy.ts`, wired in `src/proxy.ts` |
| API routes: forward (307) or refuse a session this deployment does not serve | `src/lib/supabase/tenant-response.ts` |
| cal.com bookings: attribute, forward, or hold + founder signal | `src/lib/calcom/attribution.ts`, `src/lib/calcom/held.ts`, `src/app/api/webhooks/calcom/route.ts` |
| Held-bookings table (control project) | `supabase/migrations/0025_calcom_held_bookings.sql` |
| Reconcile and purge held bookings | `scripts/replay-held-calcom.mjs` |
| Write gate: a dedicated deployment is read-only until `JC_DASHBOARD_WRITES_ENABLED=1` | `src/lib/supabase/write-gate.ts` (route check + read-only data client) |
| Tests | `src/lib/supabase/*.test.ts` (incl. the route manifest), `src/lib/calcom/*.test.ts`, `src/app/api/webhooks/calcom/tenancy.test.ts`, `src/test/tenantIsolation.test.ts`, `src/test/writeGate.test.ts` (every write path, shut and open) |

Three modes, all from env:

1. **Shared, nothing new set** (today's `mate-onboarding`): byte-identical behavior.
2. **Dedicated** (`mate-jc`): `SUPABASE_DATA_URL` + `SUPABASE_DATA_SECRET_KEY` +
   `MATE_DATA_SESSION_IDS`. Data reads/writes go to J&C's project; logins,
   `portal_members`, `portal_access` and our CRM row (`contacts.monthly_retainer`) stay
   on the main project. Only J&C's session is served. The demo, onboarding, signup,
   waitlist, code claim, `/handoff` and the internal app shell answer 404. The public
   demo session can never be listed (config refuses it). A half-set config answers 503.
   The calendar cron's session scan is filtered to J&C's session in the query itself.
   **It starts read-only.** Until `JC_DASHBOARD_WRITES_ENABLED` is exactly `1`, every
   write to J&C's project is refused server-side, so a deployment that is up during
   prep can't write anything the final copy would overwrite or miss. Reads work, so
   the deployment can be checked against the rehearsal copy.
   - Every write route answers `503 {"error":"Dashboard writes are not enabled on this
     deployment yet.","writes":"disabled"}` before it reads, sends or writes anything
     (token routes check their token first, so a bad token is still 401).
   - Browser OAuth flows (Google, QuickBooks) send the user back to the dashboard with
     `?google=writes_disabled` / `?qb=writes_disabled`; no code is exchanged.
   - cal.com bookings are **held** in the control project with a founder alert (§ Held
     cal.com bookings) and replayed once writes are on.
   - Backstop: the data client itself is read-only while the gate is shut (table
     insert/update/upsert/delete, every RPC, storage writes all throw), so a write path
     that missed its route check still can't reach J&C's project.
   - The shared deployment never reads the variable.
3. **Shared with J&C moved out**: `MATE_MOVED_SESSIONS` on `mate-onboarding`.
   - J&C dashboard **pages** 307 to the new host (the user signs in there once).
   - J&C dashboard **APIs** answer **410** "This dashboard has moved. Reload the page."
     They are never redirected: a stale browser tab would replay the request at the new
     domain without that domain's login cookie. The reload lands on the page redirect.
   - **Machine callers** carrying J&C's session (ingest, postcall, quote-scan, signal,
     Google connect) get a 307 to the same path and query on the new host. A 307 keeps
     the method and body; the caller re-sends its own headers (ingest token, `k=` query).
   - **cal.com** (no session in the payload): a booking attributed to J&C by its signed
     event type or organizer (`CALCOM_BOOKING_OWNERS`) is forwarded server-side with the
     exact signed body and only `content-type` + `x-cal-signature-256`. If the forward
     fails, or the booking can't be attributed, it is **held** in
     `calcom_held_bookings` and the founder is told through `outbound_texts` (the
     router). Nothing is written to the old project and nothing is dropped.
   - The ads and calendar crons skip J&C (the calendar scan excludes it in the query).

## Names

| | Value |
|---|---|
| Vercel team | `kaden-2445s-projects` (`team_BSZEdbYj9rvAhYt4mbBDOL97`) |
| Existing project (stays) | `mate-onboarding` (`prj_cIcZLh5xs4iRMCBhQidqIKclVKEJ`), `mate.auto-mate.business` |
| New project | **`mate-jc`** |
| New domain | **`jc.mate.auto-mate.business`** (Porkbun A record `jc.mate` to `76.76.21.21`, same as `mate`) |
| J&C session | `61400e73-0570-4167-88d9-d3a69650b15b` |
| Logins / control project | `jeqnvdlfybpmbovywknz` (unchanged) |
| Data project | `kbzsggzhcnfsgbqmybsf` (J&C's own) |
| Deploy checkout | a clean detached worktree of `origin/main` at `~/kaden/projects/mate-onboarding/.worktrees/deploy-mate-jc`, linked to `mate-jc`. **Never run `vercel link` in the main checkout**: its `.vercel/project.json` points at `mate-onboarding`, and relinking it would send the next shared deploy to the wrong project |

## Env vars

### `mate-jc` (Production)

New:

| Name | Value source |
|---|---|
| `SUPABASE_DATA_URL` | Keychain `JC_SUPABASE_URL` |
| `SUPABASE_DATA_SECRET_KEY` | Keychain `JC_SUPABASE_SECRET_KEY` |
| `MATE_DATA_SESSION_IDS` | `61400e73-0570-4167-88d9-d3a69650b15b` |
| `CALCOM_BOOKING_OWNERS` | same value as on `mate-onboarding` (below); here it only refuses bookings for other tenants |

Same as `mate-onboarding` (login project and shared services):

| Name | Value source |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Keychain, same names (amos-ui scope; same project `jeqnvdl…`) |
| `LEADS_INGEST_TOKEN` | Keychain, same name. Must equal the shared project's value so a missed n8n node still lands through the 307 (checked in prep step 6) |
| `META_JC_AD_ACCOUNT`, `META_JC_PAGE_TOKEN` | Keychain, same names |
| `CAL_JC_API_KEY`, `CALCOM_WEBHOOK_SECRET` | Keychain, same names. `CALCOM_WEBHOOK_SECRET` must equal the shared value: forwarded and replayed bookings are verified with it |
| `TELNYX_API_KEY` | Keychain, same name |
| `GEMINI_API_KEY`, `OPENAI_API_KEY` | Keychain, same names |
| `LEAD_INTAKE_WEBHOOK_URL`, `LEAD_INTAKE_SECRET` | Keychain, same names |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Keychain, same names |
| `PORTKEY_BASE_URL`, `MATE_TELNYX_NUMBER` | Not in the Keychain. Copy from `mate-onboarding` in the Vercel dashboard (founder) |
| `AGENT_WEBHOOK_TOKEN` | Not in the Keychain. **Preferred:** copy the shared value (dashboard) so a postcall that n8n still sends to the old host lands through the 307. If it can't be read (Sensitive), use a fresh value (Keychain `MATE_JC_AGENT_WEBHOOK_TOKEN`) and accept that a missed n8n node fails loudly (401 at the new host, n8n error workflow alerts) instead of landing |
| `QBO_*` (7 vars) | Only if J&C uses the Money zone. Copy in the dashboard; `QBO_REDIRECT_URI` becomes the new host (add it in the Intuit app). Without them the Money zone shows locked |

Changed or fresh values:

| Name | Value |
|---|---|
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://jc.mate.auto-mate.business/api/connect/google/callback` (also add it to the Google OAuth client's authorized redirect URIs). J&C's calendar token is copied with the data, so the cron works without reconnecting |
| `SIGNAL_TOKEN` | fresh, Keychain `MATE_JC_SIGNAL_TOKEN` (only the e2e page uses it) |
| `CRON_SECRET` | fresh, Keychain `MATE_JC_CRON_SECRET`. **Set only at switch step 4**; until then both crons answer 401 and write nothing |
| `META_JC_SESSION_ID`, `JC_ONBOARDING_SESSION_ID` | `61400e73-0570-4167-88d9-d3a69650b15b`, **set only at switch step 4** |
| `JC_DASHBOARD_WRITES_ENABLED` | **Not set during prep** (read-only). `1` only at switch step 2 (runbook 5b), right after the shared app stops serving J&C (step 1, runbook 5a), which itself runs only once the runbook has verified the final copy and blocked the old project's J&C writes. Rollback step (a) removes it |

Not needed on `mate-jc` (onboarding/demo only): `MATE_SESSION_SECRET`,
`DEMO_TELNYX_NUMBER`, `DEMO_MAX_*`.

### `mate-onboarding` (Production)

| Name | When | Value |
|---|---|---|
| `CALCOM_BOOKING_OWNERS` | prep (inert until a session is moved) | `61400e73-0570-4167-88d9-d3a69650b15b=event:<J&C event type id>` for each J&C event type, plus `…=organizer:<J&C organizer email>` as a second key. Find the ids with prep step 2 |
| `MATE_MOVED_SESSIONS` | switch step 1 (runbook 5a) | `61400e73-0570-4167-88d9-d3a69650b15b=https://jc.mate.auto-mate.business` |

## Commands

Values never go on the command line: each one is piped from `secret run` (output is
masked) or generated inside the same shell. Env vars apply to the **next** deployment,
so every env change is followed by a deploy.

```bash
S=~/kaden/amos/scripts/secrets/secret.mjs
JC=61400e73-0570-4167-88d9-d3a69650b15b
MAIN=~/kaden/projects/mate-onboarding                    # linked to mate-onboarding
JCDIR=~/kaden/projects/mate-onboarding/.worktrees/deploy-mate-jc   # linked to mate-jc
```

### Prep (any day before the switch; nothing live changes)

1. Merge `polly/jc-dashboard-copy` to `main` after review. Apply
   `supabase/migrations/0025_calcom_held_bookings.sql` to the **control** project
   (`jeqnvdlfybpmbovywknz`) only. Deploy the shared project from clean `main` (no new
   env = no behavior change):
   ```bash
   cd $MAIN && git status --short && git pull origin main && vercel deploy --prod --yes
   ```
2. Find J&C's cal.com event type ids (ids and slugs only, nothing about bookings), then
   set the owner map on the shared project. It does nothing until a session is moved:
   ```bash
   node $S run -e CAL_JC_API_KEY -- sh -c 'curl -s -H "Authorization: Bearer $CAL_JC_API_KEY" -H "cal-api-version: 2024-06-14" https://api.cal.com/v2/event-types | jq "[.. | objects | select(has(\"slug\") and has(\"id\")) | {id, slug}]"'
   cd $MAIN
   printf %s "$JC=event:<id>,$JC=organizer:<organizer email>" | vercel env add CALCOM_BOOKING_OWNERS production
   ```
3. Create the project and a clean deploy checkout:
   ```bash
   cd $MAIN && git fetch origin
   git worktree add --detach .worktrees/deploy-mate-jc origin/main
   cd $JCDIR
   vercel project add mate-jc --scope kaden-2445s-projects
   vercel link --yes --project mate-jc --scope kaden-2445s-projects
   ```
4. Env vars on `mate-jc` (run in `$JCDIR`; **not** `JC_DASHBOARD_WRITES_ENABLED`,
   `CRON_SECRET`, `META_JC_SESSION_ID`, `JC_ONBOARDING_SESSION_ID` yet, so the
   deployment is read-only and its crons are off):
   ```bash
   cd $JCDIR
   node $S run -e JC_SUPABASE_URL -- sh -c 'printf %s "$JC_SUPABASE_URL" | vercel env add SUPABASE_DATA_URL production --sensitive'
   node $S run -e JC_SUPABASE_SECRET_KEY -- sh -c 'printf %s "$JC_SUPABASE_SECRET_KEY" | vercel env add SUPABASE_DATA_SECRET_KEY production --sensitive'
   printf %s "$JC" | vercel env add MATE_DATA_SESSION_IDS production
   printf %s "$JC=event:<id>,$JC=organizer:<organizer email>" | vercel env add CALCOM_BOOKING_OWNERS production
   for N in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY \
            LEADS_INGEST_TOKEN META_JC_AD_ACCOUNT META_JC_PAGE_TOKEN CAL_JC_API_KEY \
            CALCOM_WEBHOOK_SECRET TELNYX_API_KEY GEMINI_API_KEY OPENAI_API_KEY \
            LEAD_INTAKE_WEBHOOK_URL LEAD_INTAKE_SECRET GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET; do
     node $S run -e "$N" -- sh -c "printf %s \"\$$N\" | vercel env add $N production --sensitive"
   done
   printf %s https://jc.mate.auto-mate.business/api/connect/google/callback | vercel env add GOOGLE_OAUTH_REDIRECT_URI production
   sh -c 'V=$(openssl rand -hex 32); printf %s "$V" | node '"$S"' set MATE_JC_SIGNAL_TOKEN && printf %s "$V" | vercel env add SIGNAL_TOKEN production --sensitive'
   # AGENT_WEBHOOK_TOKEN, PORTKEY_BASE_URL, MATE_TELNYX_NUMBER (and QBO_* if used): founder, dashboard (see table).
   vercel env ls production   # names only; check against the tables above
   ```
5. Deploy and attach the domain:
   ```bash
   cd $JCDIR && vercel deploy --prod --yes
   vercel domains add jc.mate.auto-mate.business mate-jc --scope kaden-2445s-projects
   ```
   DNS (Porkbun, founder): A record `jc.mate` to `76.76.21.21`.
   Login allowlists (founder, dashboards; GET on `/config/auth` is blocked by the
   secret guard): Supabase `jeqnvdlfybpmbovywknz` → Authentication → URL Configuration →
   add `https://jc.mate.auto-mate.business/**`; Google OAuth client → add the new
   callback URI.
6. Smoke test (reads the rehearsal copy in J&C's project, writes nothing):
   ```bash
   H=https://jc.mate.auto-mate.business
   for p in /dash/demo /demo /signup; do curl -s -o /dev/null -w "$p %{http_code}\n" $H$p; done          # 404 each
   curl -s -o /dev/null -w '%{http_code}\n' $H/api/ads/refresh                                           # 401 (no CRON_SECRET yet)
   # Same ingest token on both hosts. Shared: 400 = token accepted, body rejected, nothing written.
   node $S run -e LEADS_INGEST_TOKEN -- sh -c 'curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "x-ingest-token: $LEADS_INGEST_TOKEN" -H "content-type: application/json" -d "{}" https://mate.auto-mate.business/api/leads/ingest'   # 400
   # mate-jc: the token is accepted and the write gate is shut (proves both).
   node $S run -e LEADS_INGEST_TOKEN -- sh -c 'curl -s -X POST -H "x-ingest-token: $LEADS_INGEST_TOKEN" -H "content-type: application/json" -d "{}" '"$H"'/api/leads/ingest' \
     | jq -e '.writes == "disabled"' && echo "mate-jc is read-only"
   ```
   Then sign in at `$H/login` with an internal account: it lands on J&C's dashboard
   showing the rehearsal copy.

   Find which Keychain entry holds the **shared** project's `CRON_SECRET` (needed for
   switch step 1). This calls the calendar cron the way Vercel does (GET + Bearer) for
   the public demo session, which has no Google connection, so it writes nothing:
   ```bash
   DEMO=b7573135-d4ec-43bb-bf33-a1d365739784
   for N in CRON_SECRET MATE_ADS_CRON_SECRET; do
     printf '%s: ' $N
     node $S run -e $N -- sh -c 'curl -s -o /dev/null -w "%{http_code}\n" -H "authorization: Bearer $'"$N"'" "https://mate.auto-mate.business/api/calendar/sync?sessionId='"$DEMO"'"'
   done
   # 200 = that entry is the shared CRON_SECRET (use it as $SHARED_CRON below); 401 = not it.
   ```
   If neither answers 200, the shared value is not in the Keychain: generate a new one,
   store it (`MATE_SHARED_CRON_SECRET`), replace `CRON_SECRET` on `mate-onboarding`
   (`vercel env rm` + `vercel env add` from the same shell) and redeploy from clean
   `main`. Vercel's own cron reads the project env, so nothing else changes.

### At the switch (runbook "Switch consumers", row 10), after the data copy

**Prerequisite, owned by the amos runbook:** the old project's J&C writes are blocked,
the final copy into J&C's project is verified, and the runbook has run `--set-switched`.
Until then `mate-jc` stays read-only: anything it wrote earlier would be overwritten or
missed by the final copy.

The order matters:
- The shared app stops serving J&C **before** `mate-jc` takes writes. Otherwise, in
  between, a J&C dashboard write on the shared app would target the blocked old project
  and fail with nothing captured.
- `mate-jc` opens writes **immediately after**, so the read-only gap is a couple of
  minutes (one deploy).
- The old crons are verified to skip J&C **before** the new crons start, so no window
  has both crons writing J&C to two projects.
- Every caller is repointed in one step.

Steps 1 and 2 are **amos RUNBOOK switch step 5** (after `--set-switched`), as sub-steps
5a and 5b. Run them back to back.

**What a caller sees in the gap between 1 and 2** (nothing is written anywhere, nothing
is lost):

| Caller | Sees |
|---|---|
| J&C user on the old dashboard link | 307 to `jc.mate.auto-mate.business`. Reads work there; any save answers 503 "Dashboard writes are not enabled on this deployment yet." Retry after step 2 |
| A stale J&C tab on the old host calling a dashboard API | 410 "This dashboard has moved. Reload the page." |
| n8n / machine caller on the old host (ingest, postcall, quote-scan, signal) | 307 to `mate-jc`, which answers 503 `writes: disabled`. n8n's error workflow reports it; the runbook's window reconcile covers anything that arrived |
| n8n already pointed at `mate-jc` | 503 `writes: disabled` (not expected: callers are repointed in step 3) |
| cal.com (old webhook URL) | shared app forwards it to `mate-jc`, which **holds** it (control project, founder alert); replayed in step 5 |
| Old crons | skip J&C (verified in step 1) |

1. **(Runbook 5a) Shared app stops serving J&C**, then verify. Deploy from clean `main`:
   ```bash
   cd $MAIN && git status --short          # must be clean
   printf %s "$JC=https://jc.mate.auto-mate.business" | vercel env add MATE_MOVED_SESSIONS production
   vercel deploy --prod --yes
   ```
   Verify (none of these writes anything). The crons are called exactly as Vercel Cron
   does: GET with the shared `CRON_SECRET`, the Keychain entry found in prep step 6.
   ```bash
   SHARED_CRON=CRON_SECRET   # or whichever entry answered 200 in prep step 6
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "https://mate.auto-mate.business/dash/$JC"   # 307 -> jc.mate…
   curl -s -o /dev/null -w '%{http_code}\n' https://mate.auto-mate.business/dash/demo                   # 200, demo unchanged
   node $S run -e $SHARED_CRON -- sh -c 'curl -sf -H "authorization: Bearer $'"$SHARED_CRON"'" https://mate.auto-mate.business/api/ads/refresh' \
     | jq -e '.ok == true and .skipped == "session served by another deployment" and (.platforms | length) == 0' \
     && echo "ads cron skips J&C"
   node $S run -e $SHARED_CRON -- sh -c 'curl -sf -H "authorization: Bearer $'"$SHARED_CRON"'" "https://mate.auto-mate.business/api/calendar/sync?sessionId='"$JC"'"' \
     | jq -e '.sessions == [{"session_id":"'"$JC"'","status":"skipped","upserted":0,"removed":0,"detail":"served by another deployment"}]' \
     && echo "calendar cron skips J&C"
   ```
   The dashboard link must 307 to `jc.mate…` and both cron lines must print. A 401
   means the wrong Keychain entry; anything else means the shared app still serves
   J&C: stop, roll back this step (`vercel env rm MATE_MOVED_SESSIONS production --yes`
   and redeploy), and leave the gate shut.
2. **(Runbook 5b) Open J&C writes on `mate-jc`, immediately:**
   ```bash
   cd $JCDIR
   printf 1 | vercel env add JC_DASHBOARD_WRITES_ENABLED production
   vercel deploy --prod --yes
   # Gate open: token accepted, body rejected (400), nothing written.
   node $S run -e LEADS_INGEST_TOKEN -- sh -c 'curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "x-ingest-token: $LEADS_INGEST_TOKEN" -H "content-type: application/json" -d "{}" https://jc.mate.auto-mate.business/api/leads/ingest'   # 400, not 503
   ```
   The value must be exactly `1` (`printf 1`, no newline); anything else stays shut.
3. **Repoint every J&C caller in this one step** (n8n snapshots first, per the runbook):
   - n8n: every HTTP node whose URL starts with `https://mate.auto-mate.business/api/`
     in First Responder `MyTAmqQsLDUtAyep` (`/api/agent/postcall`, `/api/agent/signal`),
     Meta Lead Ads ingest `xXfLDJ2J9t5w3xF7` (`/api/leads/ingest`), the quote-scan
     schedule (`/api/agent/quote-scan`) and the inactive website form `wmFg5Mdrt60fSNTY`
     (rebuild from `web-intake/build-workflow.mjs`) → `https://jc.mate.auto-mate.business`.
     If `AGENT_WEBHOOK_TOKEN` / `SIGNAL_TOKEN` on `mate-jc` are fresh values, change the
     `k=` query in the same edit.
   - cal.com: J&C's booking webhook URL → `https://jc.mate.auto-mate.business/api/webhooks/calcom`.
     Anything cal.com still sends to the old URL is forwarded or held (never lost), but
     the webhook should not depend on that.
4. **Turn the dedicated crons on**, deploy:
   ```bash
   cd $JCDIR
   printf %s "$JC" | vercel env add META_JC_SESSION_ID production
   printf %s "$JC" | vercel env add JC_ONBOARDING_SESSION_ID production
   sh -c 'V=$(openssl rand -hex 32); printf %s "$V" | node '"$S"' set MATE_JC_CRON_SECRET && printf %s "$V" | vercel env add CRON_SECRET production --sensitive'
   vercel deploy --prod --yes
   ```
5. **Verify the new host**:
   ```bash
   node $S run -e MATE_JC_CRON_SECRET -- sh -c 'curl -s -H "authorization: Bearer $MATE_JC_CRON_SECRET" https://jc.mate.auto-mate.business/api/ads/refresh'   # ok, writes J&C ad_metrics to J&C's project
   node $S run -e LEADS_INGEST_TOKEN -- sh -c 'curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -X POST -H "x-ingest-token: $LEADS_INGEST_TOKEN" -H "content-type: application/json" -d "{\"session_id\":\"'"$JC"'\",\"leads\":[]}" https://mate.auto-mate.business/api/leads/ingest'   # 307 -> jc.mate…/api/leads/ingest
   cd $MAIN && node $S run -e NEXT_PUBLIC_SUPABASE_URL -e SUPABASE_SECRET_KEY -- node scripts/replay-held-calcom.mjs   # open held bookings
   ```
   Any booking held while `mate-jc` was read-only (reason "dashboard writes are not
   enabled on this deployment yet": prep, or the gap between steps 1 and 2) is replayed
   now to `https://jc.mate.auto-mate.business` (§ Held cal.com bookings); the list
   should then read "0 open held booking(s)". Watch the next real lead arrive in
   `vercel logs` for `mate-jc`. J&C users sign in once on the new domain (cookies are
   per domain).

## Held cal.com bookings

A held booking is one a deployment would not write: on the shared deployment, a moved
client's booking it could not forward or attribute; on `mate-jc`, any booking not
attributed (by `CALCOM_BOOKING_OWNERS`) to J&C's session, including when that config is
missing or malformed, and **every** booking while its write gate is shut (prep, the
gap between switch steps 1 and 2, and rollback step (a) onward). Nothing is written to either project's client data. The founder gets a text
through the router (`outbound_texts`, source `mate:calcom-held:<ref>`); it names no
lead.

Exactly one alert per delivery:

- **Keys.** `dedupe_key` = trigger + booking uid (or a SHA-256 of the signed body when
  there is no uid). `alert_key` = `mate:calcom-held:<full SHA-256 hex of dedupe_key>`,
  computed before anything is stored. It is the alert's `outbound_texts.source` and is
  stored on the held row; the text (with a 12-hex `ref`) depends only on it, so a
  booking that could not be stored and the same booking stored on a retry enqueue the
  identical alert.
- **The database is the gate.** Migration 0025 adds a unique index on
  `outbound_texts(source)` limited to `source like 'mate:calcom-held:%'` (no other
  source is affected; 0 existing rows matched `mate:%` when this was written). The
  first insert for a key wins. Any other insert for it (retry, concurrent delivery, a
  slow delivery that resumes late) fails with a unique violation, which counts as
  "already queued". There is no check-then-insert window and no claim to expire.
- **Answers.** `202` only when the held row is stored and the alert is queued (by this
  delivery or an earlier one). Held but the alert insert failed for any other reason:
  `503`. Not stored: `500` (the alert is still attempted). cal.com retries non-2xx;
  every retry is idempotent.

The list below shows each row's `ref` and `alert=queued | NONE` (looked up by source).

```bash
cd $MAIN
# List open held rows (id prefix, time, reason, target session prefix; no booking content).
node $S run -e NEXT_PUBLIC_SUPABASE_URL -e SUPABASE_SECRET_KEY -- node scripts/replay-held-calcom.mjs
# J&C's (or its target is J&C): replay to J&C's deployment. Dry run first, then --apply.
node $S run -e NEXT_PUBLIC_SUPABASE_URL -e SUPABASE_SECRET_KEY -e CALCOM_WEBHOOK_SECRET -- \
  node scripts/replay-held-calcom.mjs --replay <id prefix> --target https://jc.mate.auto-mate.business --apply
# Belongs to a tenant still on the shared app: replay to https://mate.auto-mate.business instead.
# Not a booking anyone needs (test, spam): close it with a reason.
node $S run -e NEXT_PUBLIC_SUPABASE_URL -e SUPABASE_SECRET_KEY -- \
  node scripts/replay-held-calcom.mjs --resolve <id prefix> --note "<why>" --apply
```

The replay re-signs the stored body and posts it exactly as cal.com would; the
receiving route is idempotent per booking uid. A row is resolved **only** when the
target answers that it applied the booking (its handler ran) or forwarded it. A `202`
that says it was held again (typically: the target's `CALCOM_BOOKING_OWNERS` still
doesn't match) leaves the row open and exits 1. An unattributed hold usually means a
new J&C event type: add its id to `CALCOM_BOOKING_OWNERS` on both projects, redeploy,
then replay.

### Retention (`calcom_held_bookings`, control project)

Held rows carry the booking exactly as cal.com signed it, so they hold a lead's
name, phone, email and notes. The table is service-role only (no anon or signed-in
access) and nothing in it is ever shown to a client.

- **Open rows are never purged automatically.** An open row may be the only copy of a
  booking. Every one is replayed to the deployment that owns it or closed by hand
  with `--resolve … --note "<why>"`. Check the list at the switch, at rollback, and
  weekly while J&C's move is in flight.
- **Resolved rows are deleted 30 days after `resolved_at`.** By then the booking lives
  in the project that owns it (replayed) or was judged not needed. Run monthly, dry
  run first:
  ```bash
  node $S run -e NEXT_PUBLIC_SUPABASE_URL -e SUPABASE_SECRET_KEY -- node scripts/replay-held-calcom.mjs --purge-resolved           # count only
  node $S run -e NEXT_PUBLIC_SUPABASE_URL -e SUPABASE_SECRET_KEY -- node scripts/replay-held-calcom.mjs --purge-resolved --apply
  ```
  It deletes only rows whose `resolved_at` is set and older than the cutoff, and
  re-checks both in the delete itself.
- **The alert rows** (`outbound_texts`, source `mate:calcom-held:*`, no lead data) follow
  amos's own outbox retention.
- At the runbook's "After 30 days" step, purge again; if the table is empty and no
  client is moved, dropping it is a founder decision.

## Rollback

The amos runbook's rollback runs in the same order; each step finishes before the next
starts. Env changes only take effect after a deploy (or an instant `vercel rollback` to
a deployment built without them).

**(a) Stop every dedicated writer.** `mate-jc` goes back to read-only with its crons
off, and the runbook turns off the amos-side J&C writers (its flags for n8n, fr-brain,
the Mac scripts and the poller).
   - Instant: `vercel rollback` `mate-jc` to its prep deployment (built before
     `JC_DASHBOARD_WRITES_ENABLED` and `CRON_SECRET` existed). Or:
   ```bash
   cd $JCDIR
   for N in JC_DASHBOARD_WRITES_ENABLED CRON_SECRET META_JC_SESSION_ID JC_ONBOARDING_SESSION_ID; do vercel env rm $N production --yes; done
   vercel deploy --prod --yes
   ```
   Check, then hand over to the runbook:
   ```bash
   H=https://jc.mate.auto-mate.business
   node $S run -e LEADS_INGEST_TOKEN -- sh -c 'curl -s -X POST -H "x-ingest-token: $LEADS_INGEST_TOKEN" -H "content-type: application/json" -d "{}" '"$H"'/api/leads/ingest' \
     | jq -e '.writes == "disabled"' && echo "mate-jc writes stopped"
   node $S run -e MATE_JC_CRON_SECRET -- sh -c 'curl -s -o /dev/null -w "%{http_code}\n" -H "authorization: Bearer $MATE_JC_CRON_SECRET" '"$H"'/api/ads/refresh'   # 401 = cron stopped
   ```
   Do **not** touch shared routing or the callers yet: the old project is still
   blocked, so anything pointed back at it now would be refused. Until step (d),
   Mate-side J&C traffic is refused or held, never written: the shared app still
   forwards J&C to `mate-jc`, whose write routes answer 503 (n8n's error workflow
   reports them, and the runbook's window reconcile lists what arrived) and whose
   cal.com webhook holds bookings.

**(b) Reverse copy (runbook),** while the old project is still blocked: everything
written to J&C's project since the switch goes back to the old one.

**(c) Unblock the old project's J&C writes (runbook).**

**(d) Only now restore the old callers and routing**, back to back:
   ```bash
   cd $MAIN && git status --short          # must be clean
   vercel env rm MATE_MOVED_SESSIONS production --yes && vercel deploy --prod --yes
   ```
   (or `vercel rollback` `mate-onboarding` to the deployment before switch step 1).
   Then re-upload the pre-switch n8n snapshots and set the cal.com webhook back to
   `https://mate.auto-mate.business/api/webhooks/calcom`. Check:
   ```bash
   curl -s -o /dev/null -w '%{redirect_url}\n' "https://mate.auto-mate.business/dash/$JC"   # must not point at jc.mate… (login or empty)
   node $S run -e $SHARED_CRON -- sh -c 'curl -sf -H "authorization: Bearer $'"$SHARED_CRON"'" "https://mate.auto-mate.business/api/calendar/sync?sessionId='"$JC"'"' \
     | jq -e '.sessions[0].detail != "served by another deployment"' && echo "shared app serves J&C again"
   ```
   (That calendar run is a real sync: J&C's appointments go to the old project, which
   owns them again.) Replay every open held cal.com booking to `https://mate.auto-mate.business`
   (§ Held cal.com bookings), including those `mate-jc` held after step (a).
   Optionally take `mate-jc` off the domain: `vercel domains rm jc.mate.auto-mate.business --yes`.

## Open items for the founder

- Domain name: `jc.mate.auto-mate.business` is a proposal. Any host works; it only
  appears in the env values above.
- Vercel plan: `mate-jc` runs the two `vercel.json` crons too; confirm the team plan
  allows them.
- Founder signal priority: a `founder_now` route for `^mate:calcom-held:` is being
  added on the amos side (`scripts/lib/amos-events/routes.mjs`); until it lands, held
  alerts reach the morning brief instead of texting.
- QuickBooks: the KVM2 rail stores QBO tokens and metrics in whatever project its own
  config points at (not checked from this repo). Before J&C connects QuickBooks on
  `mate-jc`, confirm the rail writes J&C's rows to J&C's project, or the Money zone
  reads nothing. `mate-jc`'s QBO
  connect is refused while its write gate is shut.
- `MATE_TELNYX_NUMBER`, `PORTKEY_BASE_URL`, `AGENT_WEBHOOK_TOKEN` and (if used) `QBO_*`
  need copying by hand; they are not in the Keychain.
- The alert retry relies on cal.com retrying a non-2xx webhook. If it does not, the
  booking is still held (never lost) but its alert may be missing; `alert=NONE` in
  the held list shows it. A backstop that texts about held rows with no alert after a few
  minutes (amos health check or a Mate cron) is not built.
