# Backstage Folio

> A two-page portfolio for makers: edit your projects on one page, show them read-only on the other.

**Daily idea · 2026-11-26**

## The idea

A portfolio builder with two pages that share the same data:

- **Maker page:** add, remove, hide and reorder projects to decide what shows first.
- **Viewer page:** a read-only version of the same portfolio, in the order the maker chose.

The top of the portfolio shows a round profile photo, your name and your profession. Below it, projects sit side by side, each with a picture, title, one-line summary and a category such as `#Hobby project` or `#University project`. Clicking a project opens its full description in a side panel.

The long-term plan is to add this to Idea Cooker, so a finished daily idea can be published to the portfolio.

## Why

- Projects stay in a repo with no presentable view; this gives them one.
- Order matters: the first project a visitor sees should be the one you choose.
- Editing and viewing are different jobs, so they get different pages, but one data source keeps them in sync.

## The prototype

A single-file web app: [`index.html`](index.html). No install or build step.

- `index.html#maker` (default): profile, project list, editor and a live viewer preview side by side.
- `index.html#view`: the read-only viewer page.
- Profile: photo (shown in a circle), name, profession and a short intro. Without a photo, your initials are shown.
- Viewer layout: projects in a side-by-side grid, read left to right and then row by row in the maker's order. The grid drops to one column at phone width.
- Reorder by dragging rows in the maker list, with the Move to top / up / down buttons, or with Alt + Up/Down on a selected row.
- Every project picture can be uploaded, changed or removed. Without a picture, a generated cover with the project's initials and a chosen colour is shown.
- Category: none, `#Hobby project` or `#University project`. University projects get a course name and course link, which is clickable in the detail panel.
- Hide a project with the Shown switch. Remove a project with Remove (undo is available for 6 seconds).
- The full description supports paragraphs (blank line) and bullets (lines starting with `- `).
- Data, including pictures, is saved in `localStorage`. Pictures are scaled down to JPEG first; if browser storage is full, the upload is rejected with a message.
- A viewer tab opened with "Open viewer in a new tab" updates live as you edit.
- Export JSON / Import JSON backs up or moves the portfolio. Reset to sample restores the four sample projects.

### Run it

```powershell
start index.html
```

## Status

🟡 **Prototype.** Maker and viewer work in one browser, but there is no backend, login or public URL, and pictures are limited by browser storage (a few MB).

## Next steps

- [ ] TODO: placeholder pictures: take a few keywords from each project's description, find a common (free stock) picture that matches them and use it as the placeholder instead of the generated cover
- [ ] Add it to Idea Cooker as a route, with the portfolio stored in a JSON file next to the server
- [ ] "Publish to portfolio" button on each finished daily idea, pre-filled from its README
- [ ] Protect the maker page (local-only or a password) and serve the viewer publicly
- [x] Image upload for covers, with the generated cover as fallback
- [x] Profile photo, name and profession at the top
- [x] Categories (`#Hobby project`, `#University project` with course link)
- [x] Side-by-side project grid on the viewer page
- [ ] Store pictures as files instead of in `localStorage`
- [ ] Touch-friendly drag reordering on phones
