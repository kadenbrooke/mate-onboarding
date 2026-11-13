# Mate on KVM2 (while Vercel is paused)

Status: **built and tested at a temporary host, not live.** The Vercel team was paused on
2026-11-11 (Hobby fair-use block until 2026-12-11), so `mate.auto-mate.business` (J&C's CRM)
is down. The founder approved moving Mate onto KVM2 under the same hostname. Every step
below that changes DNS, writes keys to KVM2, touches n8n or takes traffic is founder-gated.
The Swingin clock moved the same way on 2026-11-12 (`~/kaden/sdco-survey`,
`GO-LIVE-RUNBOOK.md` "Clock on KVM2"); this follows that pattern.

**Test deploy, 2026-11-13 (~12:20 to 12:36 MST), release 1320414fb135 at
`https://mate-test.automateutah.com`** (temporary Porkbun record 603477961, `A 72.60.226.53`).
`app.env` written with `--session-secret generate` (test only; the production choice is open,
see below): 32 names, mode 600, lengths equal to the helper's, 0 placeholders. Build at
`nice -n 19 ionice -c3`: 157 s, lowest MemAvailable 2909 MB (3785 MB before), image 1.03 GB.
Container healthy, 0 restarts, ~156 MiB of 768 MiB; read-only root confirmed, `/tmp` writable.
Every smoke check below passed: `/` 307 to `/login?next=%2F`, `/login` 200, `/demo` 200,
`/dash/demo` 200 (Supabase reachable), auth callback / sign-out / QuickBooks / Google callbacks
all on the pinned host with and without a forged `X-Forwarded-Host`, middleware redirects
relative (`/login?next=...`), both cron routes 401 without the secret, `next/image` 200 (sharp),
Let's Encrypt certificate to 2027-02-11, no errors in the logs. Not exercised: a real sign-in
(Supabase only redirects to `mate.auto-mate.business`), a cron run with the real secret (it
writes production data), the n8n workflow. Nothing else on KVM2, DNS, Supabase or n8n changed.

**Redeployed 2026-11-13 ~13:17 MST, release 95a34fd05daf** (review fixes: every `?next=` validated,
the proxy's redirects pinned, base image pinned by digest), same `app.env`. Build 71 s, lowest
MemAvailable 2369 MB, container healthy, 0 restarts, ~79 MiB. A forged `Host`, `X-Forwarded-Host`,
`-Proto` or `-Port`, through Traefik or straight at the container, leaves every Location on
`https://mate-test.automateutah.com` (absolute); `/codes?next=https://evil.example` goes to `/login`
with no next. Previous release 1320414fb135 and its image stay on KVM2 for rollback.

## What is on this branch

- `Dockerfile`: `next build` / `next start` on `node:22.23.3-alpine` pinned by digest (the CI Node major), npm
  from `package-lock.json`, runs as `node`, `NODE_ENV=production`. `sharp` is a runtime
  dependency, so `next/image` works. `NEXT_PUBLIC_MATE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are build args (Next inlines them); no server key
  enters the image. The publishable key is public by design and visible in `docker history`.
- `deploy/kvm2/docker-compose.yml`: compose project `mate`, container `mate`, behind KVM2's
  Traefik (`root_default`, `websecure`, `mytlschallenge`), `mem_limit 768m`, `cpus 1.0`,
  read-only root with tmpfs only at `/app/.next/cache` and `/tmp`, `cap_drop: ALL`,
  `no-new-privileges`, `restart: unless-stopped`, `env_file /opt/mate/app.env`, `NODE_ENV`
  fixed. One router, `Host(${MATE_HOST:-mate.auto-mate.business})`; the same `MATE_HOST`
  builds `NEXT_PUBLIC_MATE_URL`, so the router and the redirect origin cannot disagree.
- `deploy/kvm2/write-app-env.mjs`: writes `app.env` (the same 32 names Vercel production held)
  from the amos secret helper into an ssh pipe that runs inside `secret run`. It refuses a
  terminal, prints names only, and refuses a missing value or one with a line break, quote,
  `$`, backslash or space. Mapping, so nothing is guessed at go-live:
  - `CRON_SECRET` comes from the helper's `MATE_ADS_CRON_SECRET` (added with the J&C Meta
    refresh), not amos-ui's `CRON_SECRET` (they differ).
  - `QBO_CLIENT_ID` from the "QuickBooks Online PRODUCTION keys" login; `QBO_STATE_SECRET` and
    `QBO_PROXY_SECRET` from the "QBO generated secrets" login. `QBO_CLIENT_SECRET` is not
    written (only the n8n rail calls Intuit, `docs/qbo/kvm2-rail.md`).
  - Rebuilt, not secret: `NEXT_PUBLIC_SUPABASE_URL` (business project), `PORTKEY_BASE_URL`,
    `QBO_ENVIRONMENT=production`, `QBO_REDIRECT_URI`, `QBO_RAIL_EXCHANGE_URL`,
    `META_JC_SESSION_ID` = `JC_ONBOARDING_SESSION_ID` = J&C's real session `61400e73…`,
    `MATE_TELNYX_NUMBER=+13854409882`, `DEMO_TELNYX_NUMBER=+13854409744`.
  - `MATE_SESSION_SECRET`: not in the helper. See "MATE_SESSION_SECRET" below.
- `src/lib/public-url.ts`: sign-out, the Supabase auth callback, Google connect + callback,
  QuickBooks connect + callback, and new referral links use only the origin of
  `NEXT_PUBLIC_MATE_URL` (never `Host` / `X-Forwarded-*`, which a client can forge), and only a
  same-site path. Self-hosted `next start` builds `request.url` from its own listen address, so
  before this they sent people to `localhost:3000`. Off Vercel in production, a missing or
  non-https value answers 500 instead of redirecting. On Vercel (`VERCEL=1`) without the
  variable it keeps the old behavior (the deployment's own URL), so preview deploys still sign in.
- `src/lib/portal/safe-next.ts` (`safeRelativePath`): every `?next=` is checked where it is written
  (the proxy's sign-in gate, the dash gate) and where it is read (the login page), and every
  pinned redirect path goes through it too. Only a same-site path survives: no absolute URL,
  `//host`, `/\host`, control character, or percent-encoded form of those (up to three rounds),
  and no unsafe nested `next` / `returnTo` / `redirect` value. Session ids from the query or the
  signed QuickBooks state are encoded as one path segment, so they cannot add `?next=...`.
- `deploy/kvm2/mate-crons.workflow.json`: the two Vercel crons (`vercel.json`) as one n8n
  workflow, inactive, same routes, same UTC times, `GET` with an `Authorization` header from an
  n8n Header Auth credential named "Mate cron secret". No secret in the file.

Tests (offline): `npm test` (includes `src/lib/public-url.test.ts` and
`src/test/publicRedirects.test.ts`, every route driven with forged Host / X-Forwarded-Host) and
`npm run test:deploy` (`deploy/kvm2/*.test.mjs`: app.env names and safety, compose labels and
hardening, the cron workflow against `vercel.json`, and the usage comment equal to step 2 here).

Layout on KVM2:

```
/opt/mate/app.env              runtime settings and keys (root, mode 600, never in git)
/opt/mate/releases/<rev>/      a git archive of one commit (+ REVISION)
/opt/mate/current -> releases/<rev>
image mate:<rev>               one per release; older ones stay for rollback
```

## MATE_SESSION_SECRET (founder decision, open)

It signs the `mate_session` cookie (`src/lib/session-cookie.ts`) and is the fallback for
`QBO_STATE_SECRET`. Vercel's copy is not in the helper and Vercel will not show it. Options:

1. Find the old value and store it: `printf %s "$V" | node $S set MATE_SESSION_SECRET` (never in
   argv). Nobody notices anything.
2. Make a new one and store it, so every later app.env rewrite keeps it:
   `node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))' | node $S set MATE_SESSION_SECRET`.
   Existing `mate_session` cookies stop verifying once; `/api/portal`, `/api/mate` and
   `/api/session` then fall back to the session id in the link, so onboarding visitors keep
   working. Supabase sign-ins are not affected (they do not use this secret).
3. `--session-secret generate` on write-app-env (no `-e MATE_SESSION_SECRET` in step 2): a new
   value only on KVM2, never stored. Same effect as 2, but each rewrite of app.env makes another.
   Used for the mate-test deploy only.

## Bring it up (founder-gated)

Run on the Mac, from a checkout of the merged commit (`git archive` sends only committed files).
For the go-live, `MATE_HOST` is unset (production host). For the test deploy it was
`MATE_HOST=mate-test.automateutah.com`.

```sh
S=/Users/kadenbrooke/kaden/amos/scripts/secrets/secret.mjs
KVM2=root@72.60.226.53
REPO=~/kaden/projects/mate-onboarding   # or the worktree that holds the merged commit
REV=$(git -C "$REPO" rev-parse --short=12 HEAD)
WRITE_ARGS=                              # or "--session-secret generate" (option 3 above; then drop -e MATE_SESSION_SECRET)

# 0. Room check: the build peaks around 1.5 GB for a few minutes; KVM2 has 2 CPUs and no swap.
#    Stop if MemAvailable is under ~2500 MB.
ssh $KVM2 'uptime; free -m; docker network inspect root_default -f "{{.Name}} ok"'

# 1. Copy the release (refuses to overwrite an existing one).
git -C "$REPO" archive --format=tar "$REV" | ssh $KVM2 "set -e; d=/opt/mate/releases/$REV; test ! -e \$d; mkdir -p \$d; tar -x -C \$d; echo $REV > \$d/REVISION; echo copied \$d"

# 2. Write app.env from the secret helper. Values only travel through the pipe; nothing is printed.
#    The ssh pipe MUST sit inside the innermost `secret run` child (sh -c). `secret run` masks its
#    child's stdout, so `secret run ... | ssh` writes "[redacted NAME]" placeholders instead of the
#    values (the clock's first go-live, 2026-11-12). Dry run first: same command with
#    `node "$1/deploy/kvm2/write-app-env.mjs" --check $3` and no ssh, prints names only.
node ~/kaden/amos/scripts/secrets/secret.mjs run --login "QuickBooks Online PRODUCTION keys (added 2026-08-06)" \
  -- node ~/kaden/amos/scripts/secrets/secret.mjs run --login "QBO generated secrets (DEL-14, 2026-08-06) — used by local + KVM2 rail (PROXY_SECRET must match the n8n QBO Live Proxy)" \
  -e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY -e SUPABASE_SECRET_KEY -e OPENAI_API_KEY -e GEMINI_API_KEY \
  -e GEMINI_API_KEY_CARSON -e PORTKEY_GATEWAY_KEY -e TELNYX_API_KEY -e LEADS_INGEST_TOKEN \
  -e CALCOM_WEBHOOK_SECRET -e CAL_JC_API_KEY -e META_JC_AD_ACCOUNT -e META_JC_PAGE_TOKEN \
  -e LEAD_INTAKE_WEBHOOK_URL -e LEAD_INTAKE_SECRET -e GOOGLE_OAUTH_CLIENT_ID -e GOOGLE_OAUTH_CLIENT_SECRET \
  -e GOOGLE_OAUTH_REDIRECT_URI -e MATE_AGENT_TOKEN -e MATE_ADS_CRON_SECRET -e MATE_SESSION_SECRET \
  -- sh -c 'node "$1/deploy/kvm2/write-app-env.mjs" $3 | ssh "$2" "set -e; umask 077; mkdir -p /opt/mate; cat > /opt/mate/app.env.new; chmod 600 /opt/mate/app.env.new; mv /opt/mate/app.env.new /opt/mate/app.env"' \
  sh "$REPO" "$KVM2" "$WRITE_ARGS"
# Names, value lengths and mode only (never cat the file): expect "600 root", 32 names, and 0
# placeholders. Compare lengths with `node $S has NAME`.
ssh $KVM2 'stat -c "%a %U" /opt/mate/app.env; awk -F= "{print \$1\"=len\"length(substr(\$0,index(\$0,\"=\")+1))}" /opt/mate/app.env | tr "\n" " "; echo; wc -l < /opt/mate/app.env; grep -c redacted /opt/mate/app.env || true'

# 3. Build at the lowest priority, then start. The old container (if any) keeps serving until
#    the new image is built. Watch memory from a second terminal: ssh $KVM2 'free -m -s 10'.
ssh $KVM2 "set -e; cd /opt/mate/releases/$REV; export MATE_REV=$REV; \
  nice -n 19 ionice -c3 docker compose --env-file /opt/mate/app.env -f deploy/kvm2/docker-compose.yml build; \
  docker compose --env-file /opt/mate/app.env -f deploy/kvm2/docker-compose.yml up -d --no-build; \
  ln -sfn releases/$REV /opt/mate/current.new; mv -T /opt/mate/current.new /opt/mate/current"
```

For the test host, put `MATE_HOST=mate-test.automateutah.com` in front of both compose commands
in step 3 (`export MATE_HOST=...` next to `MATE_REV`).

## Smoke checks

```sh
H=https://mate.auto-mate.business     # or https://mate-test.automateutah.com for the test deploy
dig +short A ${H#https://}                                                       # 72.60.226.53
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' $H/                    # 307 .../login?next=%2F (signed out)
curl -sSI -H 'X-Forwarded-Host: evil.example' -H 'X-Forwarded-Proto: http' "$H/codes?x=1" | grep -i '^location'   # location: $H/login?next=%2Fcodes%3Fx%3D1 (the proxy pins it too)
curl -sS -o /dev/null -w '%{http_code}\n' $H/login                               # 200
curl -sS -o /dev/null -w '%{http_code}\n' $H/demo                                # 200 (public lander)
# The pinned redirects: forged Host / X-Forwarded-* must not move them off $H.
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' $H/auth/callback       # 307 $H/login?error=oauth
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'X-Forwarded-Host: evil.example' -H 'X-Forwarded-Proto: http' $H/auth/callback   # 307 $H/login?error=oauth
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' $H/auth/signout        # 303 $H/login?error=unauthorized
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "$H/api/qb/callback?state=x"  # 307 $H/login?error=qb_state
curl -sS -o /dev/null -w '%{http_code}\n' $H/api/calendar/sync                   # 401 (no cron secret)
curl -sS -o /dev/null -w '%{http_code}\n' $H/api/ads/refresh                     # 401
echo | openssl s_client -connect ${H#https://}:443 -servername ${H#https://} 2>/dev/null | openssl x509 -noout -subject -issuer -enddate   # Let's Encrypt, ~90 days
ssh $KVM2 'docker inspect -f "{{.State.Health.Status}} restarts={{.RestartCount}}" mate
  docker stats --no-stream --format "{{.MemUsage}} {{.CPUPerc}}" mate
  docker logs --since 10m mate 2>&1 | grep -iE "EROFS|EACCES|read-only|error" || echo "no errors in logs"
  free -m'
```

Then by hand on a phone: sign in as a J&C member, see the dashboard, sign out, land on `$H/login`.

## n8n crons (founder-gated, at go-live)

Vercel Cron does not run while the team is paused, so the calendar sync (12:00 UTC) and the ads
refresh (13:00 UTC) stop until this is on. Do NOT run it against the test host.

1. Create the credential (prints only its id; the value never leaves the pipe):
   ```sh
   node $S run -e N8N_API_KEY -e MATE_ADS_CRON_SECRET -- node --input-type=module -e '
     const r = await fetch("https://n8n.auto-mate.business/api/v1/credentials", { method: "POST",
       headers: { "content-type": "application/json", "X-N8N-API-KEY": process.env.N8N_API_KEY },
       body: JSON.stringify({ name: "Mate cron secret", type: "httpHeaderAuth",
         data: { name: "Authorization", value: `Bearer ${process.env.MATE_ADS_CRON_SECRET}` } }) });
     const j = await r.json(); console.log(r.status, j.id ?? j.message);'
   ```
2. In n8n: Workflows, Import from file, `deploy/kvm2/mate-crons.workflow.json`. Open both HTTP
   nodes and pick the "Mate cron secret" credential (the file holds a placeholder id). Save.
3. Test once by hand from n8n ("Test workflow" on each trigger) after the DNS switch: each HTTP
   node returns 200 with per-platform / per-session results. A 401 means the credential does not
   match `CRON_SECRET` in app.env (both come from `MATE_ADS_CRON_SECRET`).
4. Activate.

## DNS switch (go-live, founder-gated)

`mate.auto-mate.business` is Porkbun record **564718323**, `A 76.76.21.21` (Vercel), TTL 600.
Edit that one record to `72.60.226.53`. Change no other record.

```sh
node $S run --login "Porkbun (DNS API — auto-mate.business)" -- node --input-type=module -e '
  const r = await fetch("https://api.porkbun.com/api/json/v3/dns/edit/auto-mate.business/564718323", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apikey: process.env.LOGIN_API_KEY, secretapikey: process.env.LOGIN_SECRET_KEY,
      name: "mate", type: "A", content: "72.60.226.53", ttl: "600" }) });
  console.log(r.status, (await r.json()).status);'
```

Order on the night:
1. Bring it up with `MATE_HOST` unset (the steps above). Traefik cannot get the certificate yet:
   DNS still points at Vercel.
2. Edit the record. Within ~10 minutes `dig +short A mate.auto-mate.business` answers
   `72.60.226.53`; the first HTTPS request makes Traefik get the Let's Encrypt certificate.
3. Smoke checks against `https://mate.auto-mate.business`, then the n8n crons.
4. Supabase Auth: nothing to change. The Site URL and Redirect URLs already name
   `mate.auto-mate.business`; the host does not change.
5. Google and Intuit: nothing to change; the redirect URIs keep the same host.
6. Take the test host down (below).

## Take the test host down

```sh
# The test container IS the mate project; the go-live rebuild replaces it in place. Only if the
# test is abandoned without going live:
ssh $KVM2 'cd /opt/mate/current && docker compose --env-file /opt/mate/app.env -f deploy/kvm2/docker-compose.yml down'
# The temporary record (automateutah.com, mate-test, A 72.60.226.53, TTL 600, record id 603477961,
# created 2026-11-13): delete it by its id once the test host is no longer needed.
node $S run --login "Porkbun (DNS API — auto-mate.business)" -- node --input-type=module -e '
  const r = await fetch("https://api.porkbun.com/api/json/v3/dns/delete/automateutah.com/603477961", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apikey: process.env.LOGIN_API_KEY, secretapikey: process.env.LOGIN_SECRET_KEY }) });
  console.log(r.status, (await r.json()).status);'
```

## Rollback

```sh
# A bad release, the previous image still on the box: start it again without a rebuild.
PREV=<previous rev>   # ls /opt/mate/releases
ssh $KVM2 "set -e; cd /opt/mate/releases/$PREV; MATE_REV=$PREV docker compose --env-file /opt/mate/app.env -f deploy/kvm2/docker-compose.yml up -d --no-build; ln -sfn releases/$PREV /opt/mate/current.new; mv -T /opt/mate/current.new /opt/mate/current"

# Take Mate on KVM2 down entirely (nothing else on KVM2 changes; the app holds no data,
# Supabase does). Deactivate the n8n crons first.
ssh $KVM2 'cd /opt/mate/current && docker compose --env-file /opt/mate/app.env -f deploy/kvm2/docker-compose.yml down'
```

While Vercel is paused there is no other host to fail over to, so "down" means Mate is off. To
point DNS back at Vercel anyway, edit record 564718323 back to `76.76.21.21`.

## Switch back to Vercel after 2026-12-11

1. Confirm the team is unpaused: the latest production deployment answers on its
   `*.vercel.app` URL (`vercel ls --prod` from the repo).
2. Optional: set `NEXT_PUBLIC_MATE_URL=https://mate.auto-mate.business` in Vercel production
   (`vercel env add NEXT_PUBLIC_MATE_URL production`). Without it Vercel keeps the old behavior
   (`VERCEL=1`, the deployment's own URL), which is correct there. Do not set it for preview.
3. Deploy the merged `main` with `vercel deploy --prod` from a clean checkout (the repo's
   deploy rule: last deploy wins).
4. Edit Porkbun record 564718323 from `72.60.226.53` back to `76.76.21.21` (the value Vercel
   asks for, if it changed). Run the smoke checks against Vercel.
5. Deactivate the n8n "Mate crons on KVM2" workflow (Vercel Cron runs them again; both are
   idempotent upserts, so an overlap day only repeats work).
6. On KVM2: `docker compose ... down` from `/opt/mate/current`, `docker image rm` every
   `mate:*` tag, then `rm /opt/mate/app.env` (keys on disk) and the `/opt/mate` directory.
