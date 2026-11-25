# 🍳 Idea Cooker

One idea a day, cooked into a prototype.

This repo holds two things:

- **The ideas**: one `yyyy-mm-dd-<slug>/` folder per day, each with a `README.md` and a small prototype. The first one is [`2026-11-25-brain-reminder/`](2026-11-25-brain-reminder/).
- **Idea Cooker**, the local web app in the repo root that makes them. Type today's idea, and Claude writes the README and prototype into a new dated folder. The app then commits that folder and pushes it to GitHub. The page lists every idea with a 🔴/🟡/🟢 traffic light that you can click to change.

## Setup (once)

1. **Node 20+**: `node -v`
2. **Log in to Claude Code.** The app uses the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), which reuses your Claude Code login (or `ANTHROPIC_API_KEY` if that is set). If you've never used the `claude` CLI on this PC:
   ```powershell
   npm install -g @anthropic-ai/claude-code
   ```
   ```powershell
   claude
   ```
   then type `/login` and finish signing in in the browser.
3. Install and start:
   ```powershell
   npm install
   ```
   ```powershell
   npm start
   ```
4. Open http://localhost:4321. The first time, click **Settings**, paste the path to this repo's local clone, click **Check**, and then **Use this repo**. Nothing is written or pushed before you do this. (The app can also point at a different repo.)

## How it works

- **Cook it**: `git pull --ff-only`, then Claude (via the Agent SDK) writes the files, and then `git commit` + `git push` for just that folder.
  - Claude only gets Read/Glob/Grep plus Write/Edit, and a permission callback limits writes to **one new** folder named `<today>-<slug>`. It can't run shell commands, touch existing ideas, or write anywhere else.
  - The README follows [`example/README.md`](example/README.md) (the BrainReminder idea): idea, why, prototype, run it, status, next steps.
- **Traffic lights**: read from the first 🔴/🟡/🟢 in each README's `## Status` section. Clicking a light rewrites that line (`🟢 **Done.** …`), commits and pushes.
  - 🔴 **Idea**: nothing runs yet · 🟡 **Prototype**: works, with clear gaps · 🟢 **Done**
- Any top-level `yyyy-mm-dd-<slug>/` folder with a `README.md` counts as an idea, so ideas you add by hand show up too. The app's own folders (`lib/`, `public/`, …) don't match the pattern, so they never appear in the list.
- Settings live in `config.json` (git-ignored): repo path, push on/off, and an optional model (blank = the Claude Code default).
- The server only listens on `127.0.0.1`.

## Test

```powershell
npm test
```

This creates a throwaway repo and a bare "GitHub" remote in your temp folder, then runs the whole flow (cook, push, list, change status, push) with a fake generator that doesn't call Claude. `npm test -- --real` runs the same test with a real Claude call (this uses your login and costs a little).
