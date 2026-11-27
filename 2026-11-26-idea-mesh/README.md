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

A local Node server ([`server.mjs`](server.mjs)) with the Mesh page ([`public/index.html`](public/index.html)). It imports Idea Cooker's modules from `../2026-11-25-idea-cooker/`, so it needs no install of its own. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for how the parts connect.

What a run does with one prompt:

1. **Ideas repo:** Idea Cooker (Claude) writes `<date>-<slug>/README.md` in the ideas repo, and the folder is committed locally. It is never pushed.
2. **Portfolio + text:** Claude writes a title, summary and description from that README. The entry is added to `portfolio.json` in Backstage Folio's import format.
3. **Website · local folder:** writes `site/<folder>/index.html` and updates `site/index.html`. Nothing is published.

On the Mesh page:

- **Canvas:** pan by dragging, and zoom with the -/Fit/+ buttons or Ctrl+scroll. A ring shows each brick's state: red and blurred for sketched, yellow for prototype, green for live. A "!" in the top-right corner marks a brick that failed in the last run, and hovering it shows the error.
- **Inspector:** select a brick to see its checks, what it takes and gives, an on/off switch and its settings (commit on/off, text tone, portfolio category). Only "Sketch approved" is checked so far.
- **Run log:** one dot per brick, with links to the portfolio entry and web page. Clicking a red dot reruns that brick.

The brick layout is fixed by `mesh.json`, which is created when you first change a setting. PassRotor and Weekly recap are display only. The Cooker and Integration tabs say they are coming next. The server's settings come from Idea Cooker's `config.json`: the repo path, the model and your rule sets.

### Run it

Claude Code needs to be logged in (the same login Idea Cooker uses). From the repo root:

```powershell
cd 2026-11-26-idea-mesh; npm start
```

Then open <http://localhost:4330>. Set `PORT` to use another port.

To run the end-to-end test, which uses a throwaway repo in `test/.tmp` and Idea Cooker's fake mode with no Claude calls:

```powershell
npm test
```

## Status

🟡 **Prototype.** One prompt writes, commits, adds a portfolio entry and builds a local page, but the Cooker and Integration pages are not built yet.

## Next steps

- [x] Map the bricks that already exist (repo, portfolio, PassRotor) and how they connect
- [x] Review the three page sketches
- [x] Build a first prototype: the local server and the Mesh page
- [ ] Cooker page: cook and sketch a brick with Idea Cooker's chat, then approve its sketch
- [ ] Integration page: run the full chain on a test idea and compare each brick's output
- [ ] Add bricks from the page (#14), and upgrade a brick with undo (#18)
- [ ] Define a simple interface every brick follows, so new ones can be plugged in
- [ ] Add the Contract, Dry run and Manual OK check layers
- [ ] Make PassRotor a real brick that supplies the credentials for pushing
- [ ] Move the website brick from a local folder to a public website
