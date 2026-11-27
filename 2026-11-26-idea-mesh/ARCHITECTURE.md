# IdeaMesh architecture

The first prototype is a local Node server (`server.mjs`) with one working page, the Mesh page. The Cooker and Integration tabs only say they come next.

- `lib/store.mjs` reads and writes `mesh.json`, which holds the bricks, their rings, on/off state, settings and connections. It also handles `runs.json` and `portfolio.json`.
- `lib/engine.mjs` is the run engine. It follows the solid connections from the prompt and calls one brick at a time. It skips bricks that are off, can't run yet, or haven't passed "Sketch approved". After the first failure it stops the chain.
- `lib/bricks.mjs` holds the three runnable bricks, built on Idea Cooker's modules, which are imported from `../2026-11-25-idea-cooker/lib/`.
- The page follows a run through server-sent events from `/api/events`.

PassRotor is shown in the network but is never called during a run.

```mermaid
flowchart LR
  subgraph Browser
    MP["Mesh page"]
    TABS["Cooker / Integration tabs: coming next"]
  end
  MP --> API["Local server API"]
  API --> REG["mesh.json: bricks, rings, on/off, settings"]
  API --> RUN["Run engine"]
  RUN --> B1["Ideas repo brick: folder + README + commit"]
  PR["PassRotor brick: display only"] -.-> B1
  B1 --> B2["Portfolio + text brick"]
  B2 --> B3["Website brick: local folder"]
  B1 --> GEN["Idea Cooker generate lib"]
  B2 --> GEN
  B2 --> PF["portfolio.json"]
  B3 --> WEB["site/ folder"]
  RUN --> LOG["runs.json: run log"]
  RUN -->|"progress events"| MP
```

The Portfolio brick calls Claude through the Claude SDK that Idea Cooker already installed. Idea Cooker's generate lib has no plain text-generation function, so this call goes to the SDK directly.
