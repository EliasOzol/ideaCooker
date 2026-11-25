# 🍳 Idea Cooker

> Write one sentence a day, get a working prototype back.

**Daily idea · 2026-11-25**

## The idea

Idea Cooker is a small local web app for the daily-idea practice that this repo is built around.
You type today's idea, and Claude turns it into a new `yyyy-mm-dd-<slug>/` folder in this repo with:

- a `README.md` in the same format as every other idea (idea, why, prototype, run it, status, next steps)
- a small prototype that actually runs, usually a single `index.html`

The app then commits that folder and pushes it to GitHub.

It works like a chat. Ideas are listed on the left, the conversation is in the middle, and the live prototype (or its README) is on the right. After the first version you keep chatting ("add a dark mode", "make it work on phones"), and every change is committed and pushed. Ideas you built before you had the app can be imported from a GitHub link or a folder. Every idea has a red/yellow/green status that you can change.

## Why

- Writing down an idea takes a minute, but building even a rough version of it is what makes it stick, and what makes a portfolio.
- When the README and first prototype cost nothing, there's no excuse to skip a day.
- One repo with one folder per day doubles as a portfolio, and the status lights show at a glance which ideas are worth coming back to.

## The prototype

A Node web app in this folder (no framework, one dependency: the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk)).

- [`server.mjs`](server.mjs): a local HTTP server on `127.0.0.1:4321` with a small JSON API. Prototypes are served from a second port (4322), a different origin, so their scripts can't call the app's API.
- [`lib/generate.mjs`](lib/generate.mjs): talks to Claude through your Claude Code login, in three ways: cook a new idea, change an existing one (the chat session is resumed, so Claude remembers the conversation), and write the README for an imported idea. Claude can only read inside the repo and write inside the one idea folder it's working on. It can't run shell commands or touch other ideas.
- [`lib/importer.mjs`](lib/importer.mjs): copies a GitHub repo, a GitHub subfolder link (`…/tree/main/folder`) or a local folder into a new dated folder. It skips `.git`, `node_modules` and virtualenvs, and dates the idea by its first commit. The original README is kept as `ORIGINAL-README.md`.
- [`lib/chats.mjs`](lib/chats.mjs): the chat history for each idea, saved in `chats/` on this PC (git-ignored)
- [`lib/git.mjs`](lib/git.mjs): `git pull --ff-only` before writing, and then a commit and push of just that idea's folder
- [`lib/ideas.mjs`](lib/ideas.mjs): finds every `yyyy-mm-dd-<slug>/` folder that has a `README.md`, and reads and writes the 🔴/🟡/🟢 line in its `## Status` section
- [`public/index.html`](public/index.html): the chat page, with the idea list, chat, and prototype/README panel. It also works on phones.
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

That runs the whole flow (cook, follow-up, import, change status, with a push after each) against a throwaway repo, with a stand-in for Claude. Add `-- --real` to use Claude for real; that costs a dollar or two.

## Status

🟡 **Prototype.** It works end to end, including real Claude runs. You start it by hand, though, and it only runs on this PC.

## Next steps

- [x] Chat to improve an existing idea's prototype
- [x] Import ideas built before the app, from a repo link or folder
- [ ] Show in the page whether Claude Code is logged in, before you cook
- [ ] Stream Claude's reply word by word instead of showing it when it's done
- [ ] Publish the prototypes with GitHub Pages and link them from the list
- [ ] Start with Windows and sit in the tray, with a reminder if there's no idea by 20:00
- [ ] Weekly recap: Claude picks the most promising 🟡 idea to take further
