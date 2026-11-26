# 🎭 Backstage Folio

> One portfolio, two sides: edit it backstage, show it on stage.

**Daily idea · 2026-11-26**

## The idea

A portfolio builder with two pages that share the same data:

- **Maker page:** add projects, remove them, reorder them and decide what shows first. Projects can also be hidden without deleting them.
- **Viewer page:** a read-only version of the same portfolio, in the order the maker chose.

Each project has a short preview (title, one-line summary, generated cover). Clicking a preview opens the full description in a side panel.

The long-term plan is to add this to Idea Cooker, so a finished daily idea can be published to the portfolio.

## Why

- Projects stay in a repo with no presentable view; this gives them one.
- Order matters: the first project a visitor sees should be the one you choose.
- Editing and viewing are different jobs, so they get different pages, but one data source keeps them in sync.

## The prototype

A single-file web app: [`index.html`](index.html). No install or build step.

- `index.html#maker` (default): profile fields, project list, editor and a live viewer preview side by side.
- `index.html#view`: the read-only viewer page.
- Reorder by dragging rows, with the Move to top / up / down buttons, or with Alt + Up/Down on a selected row.
- The first shown project is featured as a large preview. The rest are listed below it.
- Hide a project with the Shown switch. Remove a project with Remove (undo is available for 6 seconds).
- The full description supports paragraphs (blank line) and bullets (lines starting with `- `).
- Data is saved in `localStorage`. A viewer tab opened with "Open viewer in a new tab" updates live as you edit.
- Export JSON / Import JSON to back up or move the portfolio. Reset to sample restores the four sample projects.

### Run it

```powershell
start index.html
```

## Status

🟡 **Prototype.** Maker and viewer work in one browser, but there is no backend, login or public URL, so only you can see the viewer.

## Next steps

- [ ] Add it to Idea Cooker as a route, with the portfolio stored in a JSON file next to the server
- [ ] "Publish to portfolio" button on each finished daily idea, pre-filled from its README
- [ ] Protect the maker page (local-only or a password) and serve the viewer publicly
- [ ] Image upload for covers, with the generated cover as fallback
- [ ] Touch-friendly drag reordering on phones
