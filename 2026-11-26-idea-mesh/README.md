# IdeaMesh

> One prompt in, and the idea travels through the whole network on its own.

**Daily idea · 2026-11-26**

## The idea

IdeaMesh connects every step an idea goes through into one automated network. A single prompt sets it off:

- the idea pops up and is pushed to the ideas repo
- it is added to the portfolio, with the portfolio text generated for it
- later, it is also pushed to a folder on a public website

Each step is a brick that can be added, updated or upgraded on its own, so the whole thing grows like an ecosystem. Existing ideas, such as [PassRotor](../2026-09-10-passrotor/), become bricks in the network too.

## Why

- Today each step is done by hand, so ideas stall between the repo, the portfolio and the web.
- Small, swappable bricks are easier to improve one at a time than one big system.
- Ideas that feed into each other are worth more than ideas that sit alone.

## The prototype

A local Node server ([`server.mjs`](server.mjs)) with two pages, Cooker and Mesh. It imports Idea Cooker's modules from `../2026-11-25-idea-cooker/`, so it needs no install of its own. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for how the parts connect.

**Cooker page** ([`public/cooker.js`](public/cooker.js)): cook and change ideas the way Idea Cooker does.

- Write a short description. Claude asks design questions with option buttons and an editable planned diagram, then writes the README and a prototype. "Save idea" writes only the README.
- Follow-ups resume the same chat. The history is shared with Idea Cooker.
- The panel has four tabs: Prototype (full panel height, with "Open in new tab" and, after a mesh run, "Generated web page"), README, Architecture (rendered Mermaid) and Sketch (Idea Cooker's editor, with Draft with Claude, Save and Ask for feedback). "Wider" hides the chat.
- **Approve sketch** is the check layer. "Run through mesh" stays disabled until the current sketch is approved, and editing the sketch resets the approval.
- Commits follow Idea Cooker's push setting.

**Mesh page** ([`public/index.html`](public/index.html)): what a run does.

1. **Ideas repo:** an idea that comes from the Cooker is used as it is. A prompt typed on the Mesh page gets a README from Claude, and the folder is committed locally but never pushed.
2. **Portfolio + text:** Claude writes a title, summary and description from the README. The entry is added to `portfolio.json` in Backstage Folio's import format.
3. **Website · local folder:** writes `site/<folder>/index.html` and updates `site/index.html`. Nothing is published.

On the Mesh page:

- **Prompt:** "Cook it first" opens the description on the Cooker page and asks the design questions. "Run mesh" sends it straight through the bricks.
- **Canvas:** pan by dragging, and zoom with the -/Fit/+ buttons or Ctrl+scroll. A ring shows each brick's state: red and blurred for sketched, yellow for prototype, green for live. A "!" in the top-right corner marks a brick that failed in the last run, and hovering it shows the error. Dragging doesn't select text on the page.
- **Inspector:** select a brick to see its checks, what it takes and gives, an on/off switch and its settings (commit on/off, text tone, portfolio category).
- **Run log:** one dot per brick, and clicking a red dot reruns that brick. "Portfolio entry" shows the entry in the right-hand panel as it would look in the portfolio, until you close it (Close or Esc).

The brick layout is fixed by `mesh.json`, which is created when you first change a setting. PassRotor and Weekly recap are display only. The Integration tab says it is coming next. The settings come from Idea Cooker's `config.json`: the repo path, the model, your rule sets, push and commands.

### Run it

Claude Code needs to be logged in (the same login Idea Cooker uses). From the repo root:

```powershell
cd 2026-11-26-idea-mesh; npm start
```

Then open <http://localhost:4330>. Prototypes are served on the next port up (4331). Set `PORT` to use other ports. If IdeaMesh is already running, stop it first so the new version starts.

To run the end-to-end test, which uses a throwaway repo in `test/.tmp` and Idea Cooker's fake mode with no Claude calls:

```powershell
npm test
```

## Status

🟡 **Prototype.** Ideas are cooked, sketched and approved on the Cooker page, then sent to the portfolio and a local site, but the Integration page is not built yet.

## Next steps

- [x] Map the bricks that already exist (repo, portfolio, PassRotor) and how they connect
- [x] Review the three page sketches
- [x] Build a first prototype: the local server and the Mesh page
- [x] Cooker page: cook and sketch an idea with Idea Cooker's chat, then approve its sketch
- [ ] Edit ARCHITECTURE.md and change the status light from the Cooker page, as in Idea Cooker
- [ ] Integration page: run the full chain on a test idea and compare each brick's output
- [ ] Add bricks from the page (#14), and upgrade a brick with undo (#18)
- [ ] Define a simple interface every brick follows, so new ones can be plugged in
- [ ] Add the Contract, Dry run and Manual OK check layers
- [ ] Make PassRotor a real brick that supplies the credentials for pushing
- [ ] Move the website brick from a local folder to a public website
