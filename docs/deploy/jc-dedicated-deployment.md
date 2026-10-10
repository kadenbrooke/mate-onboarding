# J&C dashboard on its own data project: deploy plan

Status: **plan only, nothing below has been run.** Every step that creates a Vercel
project, sets an env var, deploys, or changes DNS, auth or n8n is founder-gated. It
pairs with the amos runbook
`departments/customer-success/clients/jc-asphalt-paving/own-db/RUNBOOK.md`
(blocker 2, consumer row 10). That runbook owns the data copy and the evening switch;
this file owns the Mate side of it.

## What the code does (branch `polly/jc-dashboard-copy`)

| Piece | Where |
|---|---|
| Which project holds data, which tenants a deployment serves | `src/lib/supabase/tenancy.ts` |
| Data client vs control (logins + CRM) client | `src/lib/supabase/service.ts` (`createServiceClient` = data, `createControlServiceClient` = logins/CRM) |
| Proxy: dedicated deployments deny by default, moved sessions forward | `src/lib/supabase/tenant-proxy.ts`, wired in `src/proxy.ts` |
| API routes: forward or refuse a session this deployment does not serve | `src/lib/supabase/tenant-response.ts` |
| Isolation tests | `src/lib/supabase/*.test.ts`, `src/test/tenantIsolation.test.ts` |

Three modes, all from env:

1. **Shared, nothing new set** (today's `mate-onboarding`): byte-identical behavior.
2. **Dedicated** (`mate-jc`): `SUPABASE_DATA_URL` + `SUPABASE_DATA_SECRET_KEY` +
   `MATE_DATA_SESSION_IDS`. Data reads/writes go to J&C's project; logins,
   `portal_members`, `portal_access` and our CRM row (`contacts.monthly_retainer`) stay
   on the main project. Only J&C's session is served. The demo, onboarding, signup,
   waitlist, code claim, `/handoff` and the internal app shell answer 404. The public
   demo session can never be listed (config refuses it). A half-set config answers 503.
3. **Shared with J&C moved out**: `MATE_MOVED_SESSIONS` on `mate-onboarding`. J&C's
   dashboard URLs 307 to the new host; dashboard API calls for J&C answer 410 ("reload");
   ingest / postcall / quote-scan / Google connect for J&C 307 to the new host (method and
   body kept); the ads and calendar crons skip J&C.

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

## Env vars on `mate-jc` (Production)

New:

| Name | Value source |
|---|---|
| `SUPABASE_DATA_URL` | Keychain `JC_SUPABASE_URL` |
| `SUPABASE_DATA_SECRET_KEY` | Keychain `JC_SUPABASE_SECRET_KEY` |
| `MATE_DATA_SESSION_IDS` | `61400e73-0570-4167-88d9-d3a69650b15b` |

Same as `mate-onboarding` (login project and shared services):

| Name | Value source |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Keychain, same names (amos-ui scope; same project `jeqnvdl…`) |
| `LEADS_INGEST_TOKEN` | Keychain, same name (n8n keeps its header; only the host changes) |
| `META_JC_SESSION_ID`, `JC_ONBOARDING_SESSION_ID` | `61400e73-0570-4167-88d9-d3a69650b15b` (**set at the switch**, see below) |
| `META_JC_AD_ACCOUNT`, `META_JC_PAGE_TOKEN` | Keychain, same names |
| `CAL_JC_API_KEY`, `CALCOM_WEBHOOK_SECRET` | Keychain, same names |
| `TELNYX_API_KEY` | Keychain, same name |
| `GEMINI_API_KEY`, `OPENAI_API_KEY` | Keychain, same names |
| `LEAD_INTAKE_WEBHOOK_URL`, `LEAD_INTAKE_SECRET` | Keychain, same names |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Keychain, same names |
| `PORTKEY_BASE_URL`, `MATE_TELNYX_NUMBER` | Not in the Keychain. Copy from `mate-onboarding` in the Vercel dashboard (founder) |
| `QBO_*` (7 vars) | Only if J&C uses the Money zone. Not in the Keychain; copy in the dashboard, and set `QBO_REDIRECT_URI` to the new host plus add it in the Intuit app. Without them the Money zone shows locked |

Changed or fresh values:

| Name | Value |
|---|---|
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://jc.mate.auto-mate.business/api/connect/google/callback` (also add it to the Google OAuth client's authorized redirect URIs). J&C's existing calendar token is copied with the data, so the cron works without reconnecting |
| `CRON_SECRET` | fresh random (**set at the switch**; until then both crons answer 401 and write nothing) |
| `AGENT_WEBHOOK_TOKEN` | fresh random, stored in Keychain as `MATE_JC_AGENT_WEBHOOK_TOKEN`; n8n's postcall / quote-scan URLs get it at the switch along with the new host |
| `SIGNAL_TOKEN` | fresh random, Keychain `MATE_JC_SIGNAL_TOKEN` (only the e2e page uses it) |

Not needed on `mate-jc` (onboarding/demo only): `MATE_SESSION_SECRET`,
`DEMO_TELNYX_NUMBER`, `DEMO_MAX_*`.

On `mate-onboarding`, at the switch only:

| Name | Value |
|---|---|
| `MATE_MOVED_SESSIONS` | `61400e73-0570-4167-88d9-d3a69650b15b=https://jc.mate.auto-mate.business` |

## Commands

Values never go on the command line: each one is piped from `secret run` (output is
masked) or generated inside the same shell. Env vars apply to the **next** deployment,
so every env change is followed by a deploy.

```bash
S=~/kaden/amos/scripts/secrets/secret.mjs
JC=61400e73-0570-4167-88d9-d3a69650b15b
```

### Prep (any day before the switch; nothing live changes)

1. Merge `polly/jc-dashboard-copy` to `main` after review, then deploy the shared
   project from clean `main` as usual (no new env set = no behavior change):
   ```bash
   cd ~/kaden/projects/mate-onboarding && git pull origin main && vercel deploy --prod --yes
   ```
2. Create the project and a clean deploy checkout:
   ```bash
   cd ~/kaden/projects/mate-onboarding && git fetch origin
   git worktree add --detach .worktrees/deploy-mate-jc origin/main
   cd .worktrees/deploy-mate-jc
   vercel project add mate-jc --scope kaden-2445s-projects
   vercel link --yes --project mate-jc --scope kaden-2445s-projects
   ```
3. Env vars (run in `.worktrees/deploy-mate-jc`):
   ```bash
   node $S run -e JC_SUPABASE_URL -- sh -c 'printf %s "$JC_SUPABASE_URL" | vercel env add SUPABASE_DATA_URL production --sensitive'
   node $S run -e JC_SUPABASE_SECRET_KEY -- sh -c 'printf %s "$JC_SUPABASE_SECRET_KEY" | vercel env add SUPABASE_DATA_SECRET_KEY production --sensitive'
   printf %s "$JC" | vercel env add MATE_DATA_SESSION_IDS production
   for N in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY \
            LEADS_INGEST_TOKEN META_JC_AD_ACCOUNT META_JC_PAGE_TOKEN CAL_JC_API_KEY \
            CALCOM_WEBHOOK_SECRET TELNYX_API_KEY GEMINI_API_KEY OPENAI_API_KEY \
            LEAD_INTAKE_WEBHOOK_URL LEAD_INTAKE_SECRET GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET; do
     node $S run -e "$N" -- sh -c "printf %s \"\$$N\" | vercel env add $N production --sensitive"
   done
   printf %s https://jc.mate.auto-mate.business/api/connect/google/callback | vercel env add GOOGLE_OAUTH_REDIRECT_URI production
   sh -c 'V=$(openssl rand -hex 32); printf %s "$V" | node '"$S"' set MATE_JC_AGENT_WEBHOOK_TOKEN && printf %s "$V" | vercel env add AGENT_WEBHOOK_TOKEN production --sensitive'
   sh -c 'V=$(openssl rand -hex 32); printf %s "$V" | node '"$S"' set MATE_JC_SIGNAL_TOKEN && printf %s "$V" | vercel env add SIGNAL_TOKEN production --sensitive'
   # PORTKEY_BASE_URL, MATE_TELNYX_NUMBER (and QBO_* if used): founder copies in the dashboard.
   vercel env ls production   # names only; check the list against the tables above
   ```
   `NEXT_PUBLIC_*` must not be Sensitive if the dashboard needs to show them; they are
   public values, so `--sensitive` on them is optional.
4. Deploy and attach the domain:
   ```bash
   vercel deploy --prod --yes
   vercel domains add jc.mate.auto-mate.business mate-jc --scope kaden-2445s-projects
   ```
   DNS (Porkbun, founder): A record `jc.mate` to `76.76.21.21`.
5. Login allowlists (founder, dashboards; GET on `/config/auth` is blocked by the secret
   guard):
   - Supabase `jeqnvdlfybpmbovywknz` → Authentication → URL Configuration → add
     `https://jc.mate.auto-mate.business/**` to Redirect URLs (Google sign-in and the
     `/auth/callback` exchange).
   - Google OAuth client used by `GOOGLE_OAUTH_CLIENT_ID` → add the new callback URI.
6. Smoke test before the switch (reads the rehearsal copy in J&C's project, writes
   nothing):
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://jc.mate.auto-mate.business/dash/demo          # 404
   curl -s -o /dev/null -w '%{http_code}\n' https://jc.mate.auto-mate.business/demo               # 404
   curl -s -o /dev/null -w '%{http_code}\n' https://jc.mate.auto-mate.business/api/ads/refresh    # 401 (no CRON_SECRET yet)
   node $S run -e LEADS_INGEST_TOKEN -- sh -c 'curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "x-ingest-token: $LEADS_INGEST_TOKEN" -H "content-type: application/json" -d "{}" https://jc.mate.auto-mate.business/api/leads/ingest'   # 400 = token accepted, nothing written
   ```
   Then sign in at `https://jc.mate.auto-mate.business/login` with an internal account:
   it lands on J&C's dashboard showing the rehearsal copy.

### At the switch (runbook "Switch consumers", row 10), after the data copy

1. `mate-jc`: turn the crons and the J&C agent config on, redeploy:
   ```bash
   cd ~/kaden/projects/mate-onboarding/.worktrees/deploy-mate-jc
   printf %s "$JC" | vercel env add META_JC_SESSION_ID production
   printf %s "$JC" | vercel env add JC_ONBOARDING_SESSION_ID production
   sh -c 'openssl rand -hex 32 | vercel env add CRON_SECRET production --sensitive'
   vercel deploy --prod --yes
   ```
2. `mate-onboarding`: forward J&C, redeploy from clean `main` (the main checkout):
   ```bash
   cd ~/kaden/projects/mate-onboarding && git status --short   # must be clean
   printf %s "$JC=https://jc.mate.auto-mate.business" | vercel env add MATE_MOVED_SESSIONS production
   vercel deploy --prod --yes
   ```
3. Point the J&C callers at the new host (n8n, founder-gated, snapshot first per the
   runbook). Every HTTP node whose URL starts with `https://mate.auto-mate.business/api/`
   in: First Responder `MyTAmqQsLDUtAyep` (`/api/agent/postcall`, `/api/agent/signal`;
   swap `k=` to `MATE_JC_AGENT_WEBHOOK_TOKEN` / `MATE_JC_SIGNAL_TOKEN`), Meta Lead Ads
   ingest `xXfLDJ2J9t5w3xF7` (`/api/leads/ingest`), the quote-scan schedule
   (`/api/agent/quote-scan`, new `k=`), and the inactive website form
   `wmFg5Mdrt60fSNTY` (rebuild from `web-intake/build-workflow.mjs` with the new host).
   The shared host's 307 is a safety net for anything missed, not the plan.
4. cal.com: change J&C's booking webhook URL to
   `https://jc.mate.auto-mate.business/api/webhooks/calcom`. **This one cannot be
   forwarded** (the payload carries no session), so a booking sent to the old host is
   written to the old project.
5. Verify:
   ```bash
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "https://mate.auto-mate.business/dash/$JC"   # 307 → jc.mate…
   curl -s -o /dev/null -w '%{http_code}\n' https://mate.auto-mate.business/dash/demo                   # 200, demo unchanged
   node $S run -e LEADS_INGEST_TOKEN -- sh -c 'curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -X POST -H "x-ingest-token: $LEADS_INGEST_TOKEN" -H "content-type: application/json" -d "{\"session_id\":\"'"$JC"'\",\"leads\":[]}" https://mate.auto-mate.business/api/leads/ingest'   # 307 → jc.mate…/api/leads/ingest
   vercel logs https://jc.mate.auto-mate.business   # next real lead lands here
   ```
   J&C users sign in once on the new domain (cookies are per domain).

## Rollback

Fastest first; each is independent.

1. **Shared forwarding off:** `vercel rollback` on `mate-onboarding` to the deployment
   before step 2 (instant), or
   `vercel env rm MATE_MOVED_SESSIONS production --yes && vercel deploy --prod --yes`
   from the clean main checkout. The old link serves J&C from the old project again.
2. **n8n / cal.com:** re-upload the pre-switch workflow snapshots (runbook), set the
   cal.com webhook back to `https://mate.auto-mate.business/api/webhooks/calcom`.
3. **`mate-jc`:** leave it up (only J&C members can see it) or, to take it down,
   `vercel domains rm jc.mate.auto-mate.business --yes` and remove `CRON_SECRET` so its
   crons stop writing to J&C's project.
4. Data written to J&C's project after the switch goes back through the runbook's
   reverse copy. That is the runbook's step, not this one.

## Open items for the founder

- Domain name: `jc.mate.auto-mate.business` is a proposal. Any host works; it only
  appears in the env values above.
- Vercel plan: each project runs the two `vercel.json` crons; confirm the team plan
  allows two more.
- `MATE_TELNYX_NUMBER`, `PORTKEY_BASE_URL` and (if used) `QBO_*` need copying by hand;
  they are not in the Keychain.
