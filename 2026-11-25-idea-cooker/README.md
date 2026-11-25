# 🍳 Idea Cooker

> Write one sentence a day, get a working prototype back.

**Daily idea · 2026-11-25**

## The idea

Idea Cooker is a small local web app for the daily-idea practice that this repo is built around.
You type today's idea, and Claude turns it into a new `yyyy-mm-dd-<slug>/` folder in this repo with:

- a `README.md` in the same format as every other idea (idea, why, prototype, run it, status, next steps)
- a small prototype that actually runs, usually a single `index.html`

The app then commits that folder and pushes it to GitHub. The page also lists every idea with a red/yellow/green status that you can change, and it keeps track of your streak.

## Why

- Writing down an idea takes a minute, but building even a rough version of it is what makes it stick, and what makes a portfolio.
- When the README and first prototype cost nothing, there's no excuse to skip a day.
- One repo with one folder per day doubles as a portfolio, and the status lights show at a glance which ideas are worth coming back to.

## The prototype

A Node web app in this folder (no framework, one dependency: the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk)).

- [`server.mjs`](server.mjs): a local HTTP server on `127.0.0.1:4321` with a small JSON API
- [`lib/generate.mjs`](lib/generate.mjs): asks Claude to write the idea, using your Claude Code login. Claude can only read inside the repo and write inside **one new** folder named `<today>-<slug>`. It can't run shell commands or touch other ideas.
- [`lib/git.mjs`](lib/git.mjs): `git pull --ff-only` before writing, and then a commit and push of just the new folder
- [`lib/ideas.mjs`](lib/ideas.mjs): finds every `yyyy-mm-dd-<slug>/` folder that has a `README.md`, and reads and writes the 🔴/🟡/🟢 line in its `## Status` section
- [`public/index.html`](public/index.html): the page (today's progress, the idea box, cook progress, and the idea list with status and filters)
- [`example/README.md`](example/README.md): the README that Claude copies the format from (BrainReminder)
- [`test/e2e.mjs`](test/e2e.mjs): an end-to-end test against a throwaway repo and remote

### Run it

You need Node 20+ and a Claude Code login (`npm install -g @anthropic-ai/claude-code`, run `claude`, then `/login`). From this folder:

```powershell
npm install
```

```powershell
npm start
```

Open http://localhost:4321. The first time, Settings opens by itself: paste the path of your local clone of this repo, click **Check**, then **Save**. Nothing is written or pushed before that. The settings are saved in `config.json`, which git ignores.

To test it:

```powershell
npm test
```

That runs the whole flow (cook, push, list, change status, push) against a throwaway repo, with a stand-in for Claude. Add `-- --real` to use Claude for real; that costs about half a dollar.

## Status

🟡 **Prototype.** It works end to end, including real Claude runs. You start it by hand, though, and it only runs on this PC.

## Next steps

- [ ] Show in the page whether Claude Code is logged in, before you cook
- [ ] "Recook" button: regenerate or improve an existing idea's prototype
- [ ] Publish the prototypes with GitHub Pages and link them from the list
- [ ] Start with Windows and sit in the tray, with a reminder if there's no idea by 20:00
- [ ] Weekly recap: Claude picks the most promising 🟡 idea to take further
