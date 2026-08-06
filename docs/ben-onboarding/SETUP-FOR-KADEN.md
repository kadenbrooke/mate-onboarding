# Mate Repo — Setup Checklist (Kaden, at extraction time)

These are the backstops that make it safe to hand a non-technical contributor (Ben) a Claude-Code-driven repo. The `CLAUDE.md.draft` makes Ben's agent *behave*; the items below make it *impossible* for a bad change to reach production without you.

## 1. Move the guardrail file into place

At extraction, rename `docs/ben-onboarding/CLAUDE.md.draft` to the repo-root `CLAUDE.md`. Keep `BEN-QUICKSTART.md` for Ben.

## 2. Add CI that runs on every PR

Create `.github/workflows/pr-check.yml` with the content below. It runs the build and the test suite on each PR; a red check blocks merge (once branch protection requires it). This catches anything Ben's agent breaks, automatically.

```yaml
name: PR check
on:
  pull_request:
    branches: [main]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm test
```

## 3. Protect `main` (GitHub)

Settings → Branches → add a rule for `main`, or via CLI:

```bash
gh api -X PUT repos/<owner>/<repo>/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=build-and-test' \
  -F 'enforce_admins=false' \
  -F 'required_pull_request_reviews[required_approving_review_count]=1' \
  -F 'restrictions=null' \
  -F 'allow_force_pushes=false' \
  -F 'allow_deletions=false'
```

Effect: no direct pushes to `main`, every change needs a PR, CI must be green, and one approval (yours) is required before merge.

## 4. Add Ben as a collaborator

Settings → Collaborators → add Ben with **Write** (not Admin). Write lets him push branches and open PRs; branch protection stops him from merging or force-pushing. `enforce_admins=false` keeps YOU able to merge without friction.

## 5. Vercel

- New Vercel project connected to this repo.
- **Prod deploys are MANUAL and stay that way**: `vercel --prod` from the repo root, run deliberately after review. Do NOT enable Vercel git-integration auto-deploy on `main` — every prod deploy is a manual, reviewed step (policy, not a gap).
- Because git-integration is intentionally off, per-PR preview URLs are NOT automatic. If Ben needs a preview for a PR, generate it manually (`vercel` without `--prod`) and share the link.
- Move env vars from the old project (they are NOT in the repo). Ben never sees them.
- Point `mate.auto-mate.business` at the new project.

## 6. Sanity check before handing off

- Open a throwaway PR that tweaks a color. Confirm: CI runs, you can merge. (Prod does NOT update on merge — it's a manual `vercel --prod`. Run it once to confirm the deploy works, then delete the PR.)
- Confirm a direct push to `main` is rejected.

Once these are in place, Ben can work entirely in plain English and the worst case is a red check on a PR you never merge.
