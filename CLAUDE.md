# Mate Dashboard — Contributor Guardrails (Claude Code)

## Who this file is for

**These guardrails scope to contractor sessions (Ben's).** They are a safety harness for a non-developer working in a paying client's dashboard, not a description of how the repo works.

**Kaden's own sessions are exempt from rules 1, 2, 3, and 5.** He owns the repo and the client relationship: he merges, he applies migrations, he deploys to production, and he edits backend, agent logic, and `supabase/**` as needed. An agent working on Kaden's instruction should follow his direction, not stop at these gates. Rule 4 (secrets) and the brand rules below apply to everyone.

If you are unsure which kind of session you are in: a session that only ever received visual requests is Ben's. A session doing backend, migration, deploy, or infrastructure work is Kaden's.

## Whose work is next to yours

This repo routinely has three or four concurrent sessions, each in its own worktree. Two consequences:

- **Merging is safe in any order.** Git combines; conflicts stop loudly and never silently drop anyone's work.
- **Deploying is the lossy step.** There is one production alias and the last deploy wins, so a deploy from a stale branch takes other sessions' merged work off the live site. Deploy only from clean `main`, after merges land. Never `vercel --prod` from a feature worktree, and never from a directory holding another session's uncommitted changes: a CLI deploy uploads whatever files are sitting there.

Database migrations are the exception. They go live the moment they are applied, whichever build holds the alias.

## Non-negotiable rules (contractor sessions)

1. **Never push to `main`.** Always create a new branch for any change (e.g. `ben/bigger-header`). `main` is protected on GitHub and will reject direct pushes anyway.
2. **Never merge.** Open a Pull Request and stop. Kaden reviews and merges every change. You do not approve or merge, even if asked.
3. **Never deploy to production.** Never run `vercel --prod` or `vercel deploy --prod`. The Pull Request creates its own preview link automatically. That is the only deploy you need.
4. **Never touch secrets.** Do not open, edit, print, or commit `.env`, `.env.local`, or any key/token. If a task seems to need a secret, stop and tell Ben to ask Kaden.
5. **Stay in the visual lane.** Only change how things look: components, styling, layout, colors, spacing, copy, images. Do NOT change:
   - `src/app/api/**` (backend routes)
   - `src/lib/agent/**`, `src/lib/assistant/**`, `src/lib/demo/**` (agent / AI logic)
   - `supabase/**` (database + migrations)
   - auth, middleware, or data-fetching logic
   If a visual change looks like it requires backend edits, stop and tell Ben it needs Kaden.

## Brand rules (match these exactly)

- Colors: white `#ede6e6`, orange `#e14d1a`, dark `#141414`. The dashboard uses a light theme.
- Fonts: headline **Syne**, body **DM Sans** (self-hosted, never Google Fonts). Logo font is Outfit 900, different from Syne.
- Logo: use the real logo asset in `public/`, never a hand-typed text wordmark.
- Icons: **Phosphor** only. No Lucide, no emoji in the UI.
- **No em dashes** anywhere (UI, copy, comments). Use commas, periods, or parentheses.

## Your workflow for every request

1. Make sure you are on a fresh branch off the latest `main`: `git fetch && git switch -c ben/<short-name> origin/main`.
2. Make the visual change Ben asked for. Keep it small and focused.
3. Verify before finishing: run `npm run build` AND `npm test`. **Both must pass.** If either fails, fix it. If you cannot fix it, do not open the PR. Stop and tell Ben what broke in plain words.
4. Commit with a clear message, push the branch, and open a Pull Request with:
   - A plain-English description of what changed and why.
   - A screenshot if you can capture one.
5. Tell Ben: the change is proposed, here is the preview link, and Kaden will review it before it goes live.

## When unsure

Ask Ben, or leave it for Kaden. Never force-push, never delete branches, never rewrite history, never edit files outside the visual lane. Small and safe beats clever.
