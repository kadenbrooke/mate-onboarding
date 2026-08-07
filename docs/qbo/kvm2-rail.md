# QBO integration — what runs where (DEL-10)

QuickBooks Online read-only financials for the Mate dashboard Money zone.

Intuit's **production** keys require every API call to originate from a static,
whitelisted egress IP (**72.60.226.53**, KVM2). Vercel serverless has no stable
egress IP, so **Vercel never calls Intuit directly**. Every outbound Intuit call
runs on the KVM2 **n8n "QBO Live Proxy"** rail, mirroring the existing **Mercury
Live Proxy** (`scripts/mercury-api.sh` + `MERCURY_BASE_URL`).

> Status: the app code (Vercel routes, lib, migration, Money zone, tests) is
> built and committed on `feat/qbo-money-zone`. The **KVM2 n8n workflows below
> are a spec, not deployed** — I cannot deploy or live-test n8n from this task.
> Ops imports/wires them, and the whole thing stays sandbox-only until Intuit
> approves production keys. Nothing here has been run against a live Intuit
> sandbox (no OAuth consent could be performed from this task).

## Split of responsibilities

| Surface | Runs | Talks to Intuit? | Holds the client secret / tokens? |
|---|---|---|---|
| **Vercel** `/api/qb/connect` | Builds the Intuit consent redirect (browser goes to Intuit, not our server). Auth-gated, signed CSRF `state` + nonce cookie. | No | No |
| **Vercel** `/api/qb/callback` | Receives the `code`+`realmId`, verifies CSRF, hands the code to the rail. | No | No |
| **Vercel** `/dash/[sessionId]` Money zone | Reads `qb_metrics` from Supabase, session-scoped, auth-gated. | No | No |
| **KVM2 n8n** `qbo-exchange` webhook | Exchanges the auth code for tokens, upserts `qb_connections`. | **Yes** (from static IP) | **Yes** |
| **KVM2 n8n** `qbo-daily-pull` (schedule) | Refreshes tokens (persists rotation), pulls P&L + Invoice + Payment, upserts `qb_metrics`. | **Yes** (from static IP) | **Yes** |

The pure logic (token rotation, request building, report parsing) is implemented
and unit-tested in `src/lib/qbo/*` and `src/lib/metrics/money.ts`. The n8n Code
nodes below reuse those exact algorithms so there is one source of truth — copy
the function bodies from the lib into the Code nodes, or (better, later) publish
the lib as a tiny module the rail imports.

## Env on KVM2 (n8n)

```
QBO_CLIENT_ID          Intuit app client id
QBO_CLIENT_SECRET      Intuit app client secret   (NEVER on Vercel)
QBO_PROXY_SECRET       shared secret; must equal Vercel's QBO_PROXY_SECRET
SUPABASE_URL           https://jeqnvdlfybpmbovywknz.supabase.co
SUPABASE_SECRET_KEY    sb_secret_...  (service role; bypasses RLS)
```

Endpoints (resolve from Intuit discovery, documented fallback in `src/lib/qbo/config.ts`):
- token endpoint: `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`
- API base: sandbox `https://sandbox-quickbooks.api.intuit.com`, prod `https://quickbooks.api.intuit.com` (select by the connection's `environment`).

---

## Workflow 1 — `qbo-exchange` (Webhook)

Triggered by the Vercel callback. Turns an authorization code into stored tokens.

1. **Webhook** node — `POST /webhook/qbo-exchange`. Body: `{ sessionId, realmId, code, environment }`.
2. **Auth guard** (IF/Code) — reject unless header `x-proxy-secret === $env.QBO_PROXY_SECRET`. Return 401 otherwise.
3. **HTTP Request → Intuit token endpoint** — `POST`, `Content-Type: application/x-www-form-urlencoded`, `Authorization: Basic base64(QBO_CLIENT_ID:QBO_CLIENT_SECRET)`, body `grant_type=authorization_code&code={code}&redirect_uri={QBO_REDIRECT_URI}`. Capture the `intuit_tid` response header. (Descriptor built by `buildTokenExchangeRequest`.)
4. **Code → applyTokenResponse** — compute `access_token_expires_at` and `refresh_token_expires_at` from the response and `now`; **take `refresh_token` from the response** (rotation). Same logic as `src/lib/qbo/tokens.ts#applyTokenResponse`.
5. **Supabase upsert `qb_connections`** — on conflict `session_id`, set `realm_id`, `environment`, the four token columns, `updated_at=now()`. Service-role key.
6. **Respond** — `{ ok: true, realmId }`, or `{ ok: false, error }` on any failure. Log `intuit_tid` on every branch.

## Workflow 2 — `qbo-daily-pull` (Schedule, daily)

Mirrors the ads cron cadence. Per n8n-default-orchestration this is scheduled on
KVM2, **not** a Vercel cron.

1. **Schedule trigger** — daily (e.g. 06:00 MT, offset from the 13:00 UTC ads cron).
2. **Supabase select `qb_connections`** — every row (or filter to `environment = <active>`).
3. **For each connection:**
   a. **Code → tokenAction** — `ok` / `refresh` / `reconnect` from the stored expiries (`src/lib/qbo/tokens.ts#tokenAction`).
   b. If `refresh`: **HTTP → token endpoint** with `grant_type=refresh_token` (`buildRefreshRequest`), then **applyTokenResponse**, then **Supabase upsert `qb_connections`** — *persist the rotated refresh token before any data call*. If `reconnect`: skip this connection, log, and (optionally) flag it for a re-consent nudge.
   c. **HTTP GET P&L** — `${apiBase}/v3/company/{realm_id}/reports/ProfitAndLoss?start_date=<month-start>&end_date=<month-end>&minorversion=73`, `Authorization: Bearer <access_token>`, `Accept: application/json`. GET only. Capture `intuit_tid`.
   d. **HTTP GET Invoices** — `.../query?query=select%20*%20from%20Invoice%20where%20Balance%20%3E%20%270%27&minorversion=73`.
   e. **HTTP GET Payments** — `.../query?query=select%20*%20from%20Payment%20where%20TxnDate%20%3E%3D%20'<month-start>'&minorversion=73`.
   f. **Code → parse + build row** — `parseProfitAndLoss`, `parseInvoicesOutstanding`, `parseCollected`, `buildQbMetricRow` (`src/lib/qbo/reports.ts`). Money → whole cents.
   g. **Supabase upsert `qb_metrics`** — on conflict `session_id,period,date_pulled`.
4. **Error isolation** — one connection's failure must not stop the others (same pattern as the ads refresh route). Log `intuit_tid` + the Intuit error envelope on every failure; Intuit support triages by `intuit_tid`.

### Read-only guarantee
Every Intuit call in both workflows is a `POST` to the **token endpoint** (OAuth
only) or a `GET` to a **report/query** endpoint. There is no `POST`/`DELETE` to
any QBO entity. The requested scope is `com.intuit.quickbooks.accounting` (the
least-privilege scope QBO offers for reports); read-only is enforced by only
ever issuing GETs against the data API.

## Manual seed / smoke test
`scripts/qbo-api.sh` is the proxy caller (mirrors `mercury-api.sh`) for hitting
the rail by hand once it is deployed — e.g. to re-run a pull or exchange a code
during setup. It never talks to Intuit directly; it POSTs to the rail webhook
with `x-proxy-secret`.
