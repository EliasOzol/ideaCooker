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

Nothing runs yet. The planned prototype is one local server with three pages, which reuses Idea Cooker's code (see [`ARCHITECTURE.md`](ARCHITECTURE.md)):

- **Cooker** ([`SKETCH-cooker.json`](SKETCH-cooker.json)): cook and sketch a new brick with Idea Cooker's chat, design questions and sketch tab. A brick passes its first check layer, "Sketch approved", before it can join the mesh.
- **Mesh** ([`SKETCH-mesh.json`](SKETCH-mesh.json)): the brick network. A coloured ring around each brick shows its state: red and blurred for sketched, yellow for prototype and green for live. A "!" icon marks a brick that failed in the last run.
- **Integration** ([`SKETCH-integration.json`](SKETCH-integration.json)): run the whole chain on a test idea and see each brick's output, like Idea Cooker's prototype view.

Runs push to the ideas repo, and the website brick writes to a local folder instead of a public site for now.

## Status

🔴 **Idea.** The three pages are sketched, but nothing is built yet.

## Next steps

- [x] Map the bricks that already exist (repo, portfolio, PassRotor) and how they connect
- [ ] Review the three page sketches
- [ ] Build a first prototype: the local server and the Mesh page
- [ ] Define a simple interface every brick follows, so new ones can be plugged in
- [ ] Add the Contract, Dry run and Manual OK check layers
- [ ] Move the website brick from a local folder to a public website
