# 🏁🧑‍💼 FinishLine

> Half-done projects don't need more ideas. They need a consultant who asks "and what does *done* mean?"

**Daily idea · 2026-11-25**

## The idea

Today's idea is about following up on two older projects instead of starting a new one:

- [**recipeRemix**](https://github.com/EliasOzol/recipeRemix): I already have a clear list of changes, and I want to talk them through with a consultant until I have a plan to finish it.
- [**Passrotor**](https://github.com/EliasOzol/Passrotor): needs the same kind of follow-up.

FinishLine is that consultant. It runs a short, structured talk per project:

1. **Snapshot**: what does it do *today*?
2. **Definition of done**: who uses it, and what can they do that they can't today? (It pushes back if your answer is too vague.)
3. **Your changes**: paste them, one per line.
4. **Rate each one**: Essential / Nice / Polish, and Small / Medium / Large.
5. **Risk**: which part are you least sure how to build? That gets a small spike first.
6. **Budget**: how many work sessions will you actually give it?

Then it builds a **finish plan**: the spike first, essentials before nice-to-haves, smallest first, fitted into your session budget. Whatever doesn't fit goes to "Later · v2". If even the essentials don't fit, it tells you so and suggests what to split.

## Why

- Old repos stall because "finished" was never defined, not because the code is hard.
- A list of changes without priorities and a time budget is just a wishlist.
- Talking it through with someone who asks annoying questions forces the decisions you've been avoiding.
- The output is a ready-to-paste **Claude brief**, so the next step is opening the repo and starting, not planning again.

## The prototype

A single-file web app: [`index.html`](index.html). No install, no build step, no network calls.

Features:

- Sidebar with **recipeRemix** and **Passrotor** preloaded (plus "Add a project" for others), each with its own conversation and a progress bar
- A scripted consultant chat with quick-reply buttons, gentle pushback and comments on your ratings ("Big *and* essential, split it")
- A live **finish plan** panel that fills in as you answer: session slots (S1, S2–3, …), impact/effort badges and a budget meter that turns red when you overcommit
- Click any card to **cut** or restore it; the plan reflows instantly
- After the plan: type `add: something` to add a change, or ask "Why this order?"
- Export: **Copy Claude brief** (a prompt to paste into Claude Code inside the repo), **Copy plan** (a Markdown checklist) or download it as `.md`
- Everything is saved in `localStorage`

Note: the consultant can't read the GitHub repos itself. You tell it what's in them, and the Claude brief asks Claude to check the plan against the real code first.

### Run it

```powershell
start index.html
```

## Status

🟡 **Prototype.** The consultation and planning work end to end, but the consultant follows a fixed script and doesn't read the repos itself.

## Next steps

- [ ] Do the recipeRemix talk for real and save the plan as `FINISH.md` in that repo
- [ ] Do the same for Passrotor
- [ ] Let the consultant read the repo (README, file tree, open issues) and suggest changes on its own
- [ ] Swap the script for an LLM that asks follow-up questions, with the same plan output
- [ ] Edit a change's rating straight from the plan card
- [ ] Export the plan as GitHub issues, one per change
