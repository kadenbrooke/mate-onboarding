# Mate Dashboard — Quick Start for Ben

Hey Ben. You do not need to know how to code to improve this dashboard. You just tell Claude Code what you want, in normal words, and it does the work. Here is everything you need.

## The idea in one line

You describe a change, Claude makes it, you get a preview link to see it, Kaden approves it to go live. You cannot break the real site.

## How to make a change

1. Open Claude Code in the mate project (Kaden sets this up on your machine once).
2. Tell it what you want, plainly. Examples:
   - "Make the main heading bigger and bolder."
   - "Change the Customize button color to the orange brand color."
   - "Add more space between the cards."
   - "The calendar looks cramped, give it more room."
3. Claude makes the change and checks that nothing broke.
4. Claude opens a **proposal** (called a Pull Request) and gives you a **preview link**. Open it to see your change live on a test copy.
5. If it looks right, tell Kaden. He approves it and it goes live. If it looks off, tell Claude what to fix and it tries again.

## What you can and cannot do

- **You can:** change how things look, colors, sizes, spacing, wording, images, layout.
- **You cannot (and should not try):** touch the behind-the-scenes logic, the database, or anything technical. Claude is told to refuse those and hand them to Kaden. That is on purpose, it keeps the live product safe.

## A few do-nots

- Do not tell Claude to "deploy to production" or "push to main." Your changes are proposals until Kaden approves them. That is the safety net.
- Do not approve your own proposals. Kaden reviews every one.
- If Claude ever asks about passwords, keys, or ".env" files, tell it no and let Kaden know.

## If something feels stuck

Just say so in plain English: "this isn't working, can you explain what happened?" Claude will tell you. When in doubt, text Kaden.

That is it. Describe what you want, review the preview, hand it to Kaden. Have fun with it.
