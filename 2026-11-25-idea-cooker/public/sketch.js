/* UI sketch editor: a wireframe made of numbered figures (no freehand drawing).
   Each figure has a kind, a short label drawn inside it, and a description of what it is and does.
   SketchEditor.mount(el, sketch, { onDirty }) -> { get(), png(), isDirty(), markSaved(), destroy(), actions } */
(function () {
  const GRID = 8;
  const FRAMES = { desktop: [1280, 800], tablet: [834, 1112], phone: [390, 844] };
  const PAD = 40;
  const TOOLS = [
    { tool: "select", key: "v", label: "Select", icon: '<path d="M4 2.5l8 5.5-3.6.8L10.5 13 9 13.8 7 9.6 4.3 12z"/>' },
    { tool: "container", key: "c", label: "Box", icon: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/>', size: [320, 200] },
    { tool: "button", key: "b", label: "Button", icon: '<rect x="2" y="5" width="12" height="6" rx="3"/>', size: [160, 48] },
    { tool: "input", key: "i", label: "Input", icon: '<rect x="2" y="5" width="12" height="6" rx="1"/><path d="M4.5 7v2"/>', size: [280, 48] },
    { tool: "dropdown", key: "d", label: "Dropdown", icon: '<rect x="2" y="5" width="12" height="6" rx="1"/><path d="M10 7.3l1.2 1.2 1.2-1.2"/>', size: [240, 48] },
    { tool: "image", key: "m", label: "Image", icon: '<rect x="2.5" y="3" width="11" height="10" rx="1"/><path d="M2.5 3l11 10M13.5 3l-11 10"/>', size: [240, 160] },
    { tool: "text", key: "t", label: "Text", icon: '<path d="M3.5 4h9M8 4v9"/>', size: [240, 32] },
    { tool: "list", key: "s", label: "List", icon: '<path d="M3 4.5h10M3 8h10M3 11.5h10"/>', size: [320, 192] },
    { tool: "circle", key: "o", label: "Circle", icon: '<circle cx="8" cy="8" r="5.5"/>', size: [80, 80] },
    { tool: "line", key: "l", label: "Arrow", icon: '<path d="M3 13L13 3M8.5 3H13v4.5"/>', size: [160, 0] },
  ];
  const KIND_NAMES = { container: "Box / section", button: "Button", input: "Text input", dropdown: "Dropdown", image: "Image", text: "Text", list: "List", circle: "Circle / icon", line: "Arrow / connector", nav: "Navigation bar", other: "Other" };
  const snap = (v) => Math.round(v / GRID) * GRID;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => "s" + Math.random().toString(36).slice(2, 9);

  let styleAdded = false;
  function addStyle() {
    if (styleAdded) return;
    styleAdded = true;
    const css = `
.sk { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.sk-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.sk-tools { display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--sunk); flex-wrap: wrap; }
.sk-tools button { width: 32px; height: 32px; border: 0; border-radius: 6px; background: transparent; color: var(--ink-2); cursor: pointer; display: grid; place-items: center; transition: background-color .12s, color .12s; }
.sk-tools button:hover { color: var(--ink); background: var(--line); }
.sk-tools button[aria-pressed=true] { background: var(--surface); color: var(--accent); box-shadow: 0 1px 2px rgb(0 0 0 / .1); }
.sk-tools svg, .sk-mini svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.sk-mini { width: 32px; height: 32px; border: 0; border-radius: 6px; background: transparent; color: var(--ink-2); cursor: pointer; display: grid; place-items: center; }
.sk-mini:hover:not(:disabled) { background: var(--sunk); color: var(--ink); }
.sk-mini:disabled { opacity: .35; cursor: default; }
.sk-bar select { height: 32px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--line-strong); background: var(--bg); font-size: 13px; color: var(--ink); }
.sk-bar .grow { flex: 1; }
.sk-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.sk-main { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 260px; }
.sk-stage { overflow: auto; background: var(--sunk); padding: 16px; outline: none; }
.sk-stage svg { display: block; width: 100%; height: auto; margin: 0 auto; touch-action: none; user-select: none; }
.sk-stage.tool-create svg { cursor: crosshair; }
.sk-insp { border-left: 1px solid var(--line); padding: 16px; overflow-y: auto; display: grid; align-content: start; gap: 12px; font-size: 14px; }
.sk-insp h3 { margin: 0; font-size: 15px; }
.sk-insp label { display: grid; gap: 4px; font-size: 13px; font-weight: 600; }
.sk-insp input, .sk-insp select, .sk-insp textarea { font: inherit; font-weight: 400; color: var(--ink); border: 1px solid var(--line-strong); border-radius: 6px; background: var(--bg); padding: 6px 8px; }
.sk-insp textarea { min-height: 120px; resize: vertical; line-height: 20px; }
.sk-insp input:focus, .sk-insp select:focus, .sk-insp textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--focus); }
.sk-insp .hint { margin: 0; color: var(--ink-2); font-size: 13px; line-height: 18px; }
.sk-insp .figs { display: grid; gap: 2px; }
.sk-insp .figs button { display: grid; grid-template-columns: 32px 1fr auto; gap: 8px; align-items: center; text-align: left; border: 0; background: transparent; padding: 6px; border-radius: 6px; font: inherit; font-size: 13px; color: var(--ink); cursor: pointer; }
.sk-insp .figs button:hover { background: var(--sunk); }
.sk-insp .figs .n { color: var(--ink-3); font-variant-numeric: tabular-nums; }
.sk-insp .figs .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sk-insp .warn { width: 8px; height: 8px; border-radius: 50%; background: var(--amber); }
.sk-insp .row { display: flex; gap: 8px; }
.sk-insp .sub { font-weight: 400; color: var(--ink-3); }
.sk-insp .sk-del { color: var(--red); }
.sk-insp .sk-del:hover { border-color: var(--red); }
@container (max-width: 700px) { .sk-main { grid-template-columns: 1fr; grid-template-rows: 1fr auto; } .sk-insp { border-left: 0; border-top: 1px solid var(--line); max-height: 45%; } }`;
    const el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* Wrap a label into lines that fit a width (rough, but good enough for a wireframe). */
  function wrap(text, width, maxLines, px = 14) {
    const per = Math.max(3, Math.floor((width - 16) / (px * 0.55)));
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "";
    for (const w of words) {
      if (!cur) cur = w;
      else if ((cur + " " + w).length <= per) cur += " " + w;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, "…"); }
    return lines.map((l) => (l.length > per ? l.slice(0, per - 1) + "…" : l));
  }

  /* One figure as SVG. Wireframe colours are fixed (paper look), so the exported picture is the same in any theme. */
  function shapeSvg(s) {
    const x = s.w < 0 ? s.x + s.w : s.x, y = s.h < 0 ? s.y + s.h : s.y;
    const w = Math.abs(s.w), h = Math.abs(s.h);
    const ink = "#4a463f", soft = "#8f8a82", fill = "#ffffff";
    const label = s.label || "";
    const text = (lines, cx, cy, anchor = "middle", weight = 500, color = ink, px = 14) =>
      `<text x="${cx}" y="${cy - ((lines.length - 1) * (px + 4)) / 2}" font-size="${px}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}" dominant-baseline="middle" font-family="Segoe UI, system-ui, sans-serif">${lines.map((l, i) => `<tspan x="${cx}" dy="${i ? px + 4 : 0}">${esc(l)}</tspan>`).join("")}</text>`;
    const maxLines = Math.max(1, Math.floor((h - 8) / 18));
    let body = "";
    switch (s.kind) {
      case "line": {
        body = `<line x1="${s.x}" y1="${s.y}" x2="${s.x + s.w}" y2="${s.y + s.h}" stroke="${ink}" stroke-width="2" marker-end="url(#sk-arrow)"/>`;
        if (label) body += text(wrap(label, 200, 2, 13), s.x + s.w / 2, s.y + s.h / 2 - 12, "middle", 500, soft, 13);
        return `<g data-id="${s.id}">${body}<line x1="${s.x}" y1="${s.y}" x2="${s.x + s.w}" y2="${s.y + s.h}" stroke="transparent" stroke-width="16"/></g>`;
      }
      case "circle":
        body = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${ink}" stroke-width="1.5"/>` + text(wrap(label, w, maxLines), x + w / 2, y + h / 2);
        break;
      case "button":
        body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(12, h / 2)}" fill="#ece8e1" stroke="${ink}" stroke-width="1.5"/>` + text(wrap(label, w, maxLines), x + w / 2, y + h / 2, "middle", 600);
        break;
      case "input":
        body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${ink}" stroke-width="1.5"/>` + text(wrap(label, w - 8, 1), x + 12, y + h / 2, "start", 400, soft);
        break;
      case "dropdown":
        body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${ink}" stroke-width="1.5"/><path d="M${x + w - 24} ${y + h / 2 - 3}l6 6 6-6" fill="none" stroke="${ink}" stroke-width="1.5"/>` + text(wrap(label, w - 36, 1), x + 12, y + h / 2, "start", 400);
        break;
      case "image":
        body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#f1eee8" stroke="${ink}" stroke-width="1.5"/><path d="M${x} ${y}L${x + w} ${y + h}M${x + w} ${y}L${x} ${y + h}" stroke="${soft}" stroke-width="1"/>`;
        if (label) { const ls = wrap(label, w - 16, Math.max(1, maxLines - 1), 13); body += `<rect x="${x + w / 2 - Math.min(w - 16, 180) / 2}" y="${y + h / 2 - (ls.length * 17 + 8) / 2}" width="${Math.min(w - 16, 180)}" height="${ls.length * 17 + 8}" rx="4" fill="#ffffff"/>` + text(ls, x + w / 2, y + h / 2, "middle", 500, ink, 13); }
        break;
      case "text":
        // Starts a little in from the left so the number badge doesn't cover the first letters.
        body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent"/>` + text(wrap(label || "Text", w - 8, maxLines), x + 16, y + Math.max(20, Math.min(h, 18 * Math.max(1, wrap(label, w - 8, maxLines).length)) / 2 + 2), "start", 400);
        break;
      case "list": {
        const rows = Math.max(1, Math.floor((h - 40) / 40));
        body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${ink}" stroke-width="1.5"/>`;
        for (let i = 1; i <= rows; i++) body += `<line x1="${x + 12}" y1="${y + 32 + i * 36}" x2="${x + w - 12}" y2="${y + 32 + i * 36}" stroke="#d6d1c8"/>`;
        body += text(wrap(label, w, 1), x + 12, y + 20, "start", 600);
        break;
      }
      case "nav":
        body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#e4e0d8" stroke="${ink}" stroke-width="1.5"/>` + text(wrap(label, w, maxLines), x + 16, y + h / 2, "start", 600);
        break;
      case "container":
        body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#fbfaf7" stroke="${ink}" stroke-width="1.5"/>` + (label ? text(wrap(label, w, 1), x + 12, y + 18, "start", 600, soft, 13) : "");
        break;
      default:
        body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${ink}" stroke-width="1.5" stroke-dasharray="6 4"/>` + text(wrap(label, w, maxLines), x + w / 2, y + h / 2);
    }
    return `<g data-id="${s.id}">${body}</g>`;
  }
  function badgeSvg(s) {
    const x = Math.min(s.x, s.x + (s.kind === "line" ? s.w : 0)), y = Math.min(s.y, s.y + (s.kind === "line" ? s.h : 0));
    const warn = !String(s.desc || "").trim();
    return `<g pointer-events="none"><circle cx="${x}" cy="${y}" r="11" fill="${warn ? "#d6951c" : "#b6461f"}"/><text x="${x}" y="${y + 0.5}" font-size="11" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI, system-ui, sans-serif">${s.n}</text></g>`;
  }
  function sceneSvg(model, { forExport = false } = {}) {
    const { w, h } = model.frame;
    const shapes = model.shapes.map(shapeSvg).join("");
    const badges = model.shapes.map(badgeSvg).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-PAD} ${-PAD} ${w + PAD * 2} ${h + PAD * 2}" width="${w + PAD * 2}" height="${h + PAD * 2}">
      <defs><marker id="sk-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#4a463f"/></marker>
      <pattern id="sk-grid" width="${GRID * 4}" height="${GRID * 4}" patternUnits="userSpaceOnUse"><path d="M${GRID * 4} 0H0V${GRID * 4}" fill="none" stroke="#ece9e3" stroke-width="1"/></pattern></defs>
      <rect x="${-PAD}" y="${-PAD}" width="${w + PAD * 2}" height="${h + PAD * 2}" fill="${forExport ? "#f3f1ec" : "transparent"}"/>
      <rect data-frame="1" x="0" y="0" width="${w}" height="${h}" fill="#ffffff" stroke="#d3cec5"/>
      ${forExport ? "" : `<rect x="0" y="0" width="${w}" height="${h}" fill="url(#sk-grid)" pointer-events="none"/>`}
      ${shapes}${badges}<g data-overlay="1"></g></svg>`;
  }

  function mount(el, sketch, opts = {}) {
    addStyle();
    const preset = FRAMES[sketch?.frame?.preset] ? sketch.frame.preset : "desktop";
    const model = {
      version: 1,
      frame: { preset, w: FRAMES[preset][0], h: sketch?.frame?.h || FRAMES[preset][1] },
      shapes: (sketch?.shapes || []).map((s) => ({ ...s })),
    };
    let tool = "select", sel = null, dirty = false, drag = null;
    const undo = [], redo = [];
    let saved = JSON.stringify(model);

    el.innerHTML = `<div class="sk" tabindex="-1">
      <div class="sk-bar">
        <div class="sk-tools" role="toolbar" aria-label="Figures">${TOOLS.map((t) => `<button type="button" data-tool="${t.tool}" title="${t.label} (${t.key.toUpperCase()})" aria-label="${t.label}" aria-pressed="${t.tool === "select"}"><svg viewBox="0 0 16 16">${t.icon}</svg></button>`).join("")}</div>
        <select data-frame-sel aria-label="Frame size"><option value="desktop">Desktop 1280</option><option value="tablet">Tablet 834</option><option value="phone">Phone 390</option></select>
        <button type="button" class="sk-mini" data-undo title="Undo (Ctrl+Z)" aria-label="Undo"><svg viewBox="0 0 16 16"><path d="M5 4L2 7l3 3M2.5 7h7a4 4 0 010 8H7"/></svg></button>
        <button type="button" class="sk-mini" data-redo title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><svg viewBox="0 0 16 16"><path d="M11 4l3 3-3 3M13.5 7h-7a4 4 0 000 8H9"/></svg></button>
        <span class="grow"></span>
        <div class="sk-actions"></div>
      </div>
      <div class="sk-main">
        <div class="sk-stage" tabindex="0" aria-label="Sketch canvas"></div>
        <aside class="sk-insp" aria-label="Figure details"></aside>
      </div>
    </div>`;
    const root = el.querySelector(".sk"), stage = el.querySelector(".sk-stage"), insp = el.querySelector(".sk-insp");
    el.querySelector("[data-frame-sel]").value = preset;

    const byId = (id) => model.shapes.find((s) => s.id === id);
    const snapshot = () => JSON.stringify(model);
    function commit(before) {
      if (before === snapshot()) return;
      undo.push(before);
      if (undo.length > 100) undo.shift();
      redo.length = 0;
      touch();
    }
    function touch() {
      const now = snapshot();
      const d = now !== saved;
      if (d !== dirty) { dirty = d; opts.onDirty?.(dirty); }
      el.querySelector("[data-undo]").disabled = !undo.length;
      el.querySelector("[data-redo]").disabled = !redo.length;
    }
    function restore(json) {
      const m = JSON.parse(json);
      model.frame = m.frame;
      model.shapes = m.shapes;
      if (sel && !byId(sel)) sel = null;
      el.querySelector("[data-frame-sel]").value = model.frame.preset;
      draw(); inspector(); touch();
    }
    function setTool(t) {
      tool = t;
      el.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === t)));
      stage.classList.toggle("tool-create", t !== "select");
    }

    let svg;
    function draw() {
      stage.innerHTML = sceneSvg(model);
      svg = stage.querySelector("svg");
      svg.style.maxWidth = `${model.frame.w + PAD * 2}px`;
      overlay();
    }
    function overlay() {
      const g = svg.querySelector("[data-overlay]");
      const s = sel && byId(sel);
      if (!s) { g.innerHTML = ""; return; }
      const hs = 10;
      const handle = (name, hx, hy) => `<rect data-handle="${name}" x="${hx - hs / 2}" y="${hy - hs / 2}" width="${hs}" height="${hs}" rx="2" fill="#fff" stroke="#b6461f" stroke-width="1.5" style="cursor:${name === "nw" || name === "se" ? "nwse" : name === "ne" || name === "sw" ? "nesw" : "move"}-resize"/>`;
      if (s.kind === "line") {
        g.innerHTML = handle("p1", s.x, s.y) + handle("p2", s.x + s.w, s.y + s.h);
        return;
      }
      g.innerHTML = `<rect x="${s.x - 4}" y="${s.y - 4}" width="${s.w + 8}" height="${s.h + 8}" fill="none" stroke="#b6461f" stroke-width="1.5" stroke-dasharray="4 3" pointer-events="none"/>` +
        handle("nw", s.x, s.y) + handle("ne", s.x + s.w, s.y) + handle("sw", s.x, s.y + s.h) + handle("se", s.x + s.w, s.y + s.h);
    }
    function toModel(e) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      return { x: p.x, y: p.y };
    }

    function inspector() {
      const s = sel && byId(sel);
      if (!s) {
        const missing = model.shapes.filter((f) => !String(f.desc || "").trim()).length;
        insp.innerHTML = `<h3>Figures</h3>
          <p class="hint">${model.shapes.length ? `Click a figure to give it a label and a description. Claude reads both.${missing ? ` ${missing} still ${missing === 1 ? "needs a description" : "need descriptions"} (amber number).` : ""}` : "Pick a figure in the toolbar, then drag on the frame (or click to drop it). Give each one a label and a description of what it is and does; Claude reads both."}</p>
          <div class="figs">${model.shapes.slice().sort((a, b) => a.n - b.n).map((f) => `<button type="button" data-pick="${f.id}"><span class="n">#${f.n}</span><span class="t">${esc(f.label || KIND_NAMES[f.kind] || f.kind)}</span>${String(f.desc || "").trim() ? "" : '<span class="warn" title="No description yet"></span>'}</button>`).join("")}</div>
          <p class="hint">Shortcuts: V select · B button · I input · D dropdown · M image · T text · C box · S list · O circle · L arrow · Delete · Ctrl+D duplicate · arrow keys move · Ctrl+Z undo</p>`;
        return;
      }
      insp.innerHTML = `<h3>Figure #${s.n}</h3>
        <label>Kind<select data-f="kind">${Object.entries(KIND_NAMES).map(([k, v]) => `<option value="${k}"${k === s.kind ? " selected" : ""}>${v}</option>`).join("")}</select></label>
        <label><span>Label <span class="sub">shown inside</span></span><input type="text" data-f="label" maxlength="120" value="${esc(s.label)}" placeholder="e.g. Save"></label>
        <label><span>Description <span class="sub">what it is and does</span></span><textarea data-f="desc" maxlength="2000" placeholder="e.g. Saves the list and shows a short “Saved” message. Disabled until something changed.">${esc(s.desc)}</textarea></label>
        <div class="row"><button type="button" class="btn" data-dup>Duplicate</button><button type="button" class="btn sk-del" data-del>Delete</button></div>`;
      let before = null;
      insp.querySelectorAll("[data-f]").forEach((inp) => {
        inp.addEventListener("focus", () => (before = snapshot()));
        inp.addEventListener("input", () => {
          if (before === null) before = snapshot();
          s[inp.dataset.f] = inp.value;
          draw();
          touch();
        });
        inp.addEventListener("change", () => { if (before !== null) commit(before); before = null; if (inp.dataset.f === "kind") inspector(); });
        inp.addEventListener("blur", () => { if (before !== null) commit(before); before = null; });
      });
      insp.querySelector("[data-del]").addEventListener("click", removeSel);
      insp.querySelector("[data-dup]").addEventListener("click", duplicate);
    }

    function select(id) { sel = id; overlay(); inspector(); }
    function removeSel() {
      if (!sel) return;
      const before = snapshot();
      model.shapes = model.shapes.filter((s) => s.id !== sel);
      sel = null;
      draw(); inspector(); commit(before);
    }
    function nextN() { return model.shapes.reduce((m, s) => Math.max(m, s.n || 0), 0) + 1; }
    function duplicate() {
      const s = sel && byId(sel);
      if (!s) return;
      const before = snapshot();
      const c = { ...s, id: uid(), n: nextN(), x: s.x + 16, y: s.y + 16 };
      model.shapes.push(c);
      sel = c.id;
      draw(); inspector(); commit(before);
    }

    // ---- pointer interactions on the canvas
    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !svg) return;
      stage.focus({ preventScroll: true });
      const p = toModel(e);
      const before = snapshot();
      const handle = e.target.closest("[data-handle]");
      const hit = e.target.closest("[data-id]");
      if (handle && sel) {
        const s = byId(sel);
        drag = { mode: "resize", h: handle.dataset.handle, s, start: { ...s }, p, before };
      } else if (tool !== "select") {
        const t = TOOLS.find((x) => x.tool === tool);
        const s = { id: uid(), n: nextN(), kind: tool, x: snap(p.x), y: snap(p.y), w: 0, h: 0, label: tool === "button" ? "Button" : "", desc: "" };
        model.shapes.push(s);
        sel = s.id;
        drag = { mode: "create", s, p: { x: s.x, y: s.y }, size: t.size, before, keep: e.shiftKey };
      } else if (hit) {
        select(hit.dataset.id);
        const s = byId(hit.dataset.id);
        drag = { mode: "move", s, start: { ...s }, p, before };
      } else {
        select(null);
        return;
      }
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    stage.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const p = toModel(e);
      const { s } = drag;
      if (drag.mode === "create") {
        s.w = snap(p.x) - s.x;
        s.h = drag.s.kind === "line" ? snap(p.y) - s.y : snap(p.y) - s.y;
      } else if (drag.mode === "move") {
        s.x = snap(drag.start.x + p.x - drag.p.x);
        s.y = snap(drag.start.y + p.y - drag.p.y);
      } else if (drag.mode === "resize") {
        const st = drag.start, dx = p.x - drag.p.x, dy = p.y - drag.p.y;
        if (drag.h === "p1") { s.x = snap(st.x + dx); s.y = snap(st.y + dy); s.w = st.x + st.w - s.x; s.h = st.y + st.h - s.y; }
        else if (drag.h === "p2") { s.w = snap(st.x + st.w + dx) - st.x; s.h = snap(st.y + st.h + dy) - st.y; }
        else {
          let x1 = st.x, y1 = st.y, x2 = st.x + st.w, y2 = st.y + st.h;
          if (drag.h.includes("w")) x1 = snap(st.x + dx);
          if (drag.h.includes("e")) x2 = snap(x2 + dx);
          if (drag.h.includes("n")) y1 = snap(st.y + dy);
          if (drag.h.includes("s")) y2 = snap(y2 + dy);
          s.x = Math.min(x1, x2 - GRID); s.y = Math.min(y1, y2 - GRID);
          s.w = Math.max(GRID, Math.abs(x2 - x1)); s.h = Math.max(GRID, Math.abs(y2 - y1));
        }
      }
      draw();
    });
    const endDrag = () => {
      if (!drag) return;
      const { s } = drag;
      if (drag.mode === "create") {
        if (s.kind === "line") {
          if (Math.abs(s.w) < GRID && Math.abs(s.h) < GRID) { s.w = drag.size[0]; s.h = 0; }
        } else {
          if (Math.abs(s.w) < GRID * 2 || Math.abs(s.h) < GRID * 2) { s.w = drag.size[0]; s.h = drag.size[1]; }
          if (s.w < 0) { s.x += s.w; s.w = -s.w; }
          if (s.h < 0) { s.y += s.h; s.h = -s.h; }
        }
        if (!drag.keep) setTool("select");
        draw(); inspector();
        const lab = insp.querySelector('[data-f="label"]');
        if (lab) { lab.focus(); lab.select(); }
      }
      commit(drag.before);
      drag = null;
    };
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);
    stage.addEventListener("dblclick", (e) => {
      if (e.target.closest("[data-id]")) insp.querySelector('[data-f="label"]')?.focus();
    });

    // ---- toolbar, frame, undo/redo, keyboard
    el.querySelector(".sk-tools").addEventListener("click", (e) => { const b = e.target.closest("[data-tool]"); if (b) setTool(b.dataset.tool); });
    el.querySelector("[data-frame-sel]").addEventListener("change", (e) => {
      const before = snapshot();
      const p = e.target.value;
      model.frame = { preset: p, w: FRAMES[p][0], h: FRAMES[p][1] };
      draw(); commit(before);
    });
    const doUndo = () => { if (!undo.length) return; redo.push(snapshot()); restore(undo.pop()); };
    const doRedo = () => { if (!redo.length) return; undo.push(snapshot()); restore(redo.pop()); };
    el.querySelector("[data-undo]").addEventListener("click", doUndo);
    el.querySelector("[data-redo]").addEventListener("click", doRedo);
    insp.addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) select(b.dataset.pick); });
    const onKey = (e) => {
      if (!root.isConnected) return;
      if (!root.contains(document.activeElement) && document.activeElement !== document.body) return;
      if (document.querySelector("dialog[open]")) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
      if (mod && e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); doRedo(); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicate(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); removeSel(); return; }
      if (e.key === "Escape" && (sel || tool !== "select")) { e.stopPropagation(); setTool("select"); select(null); return; }
      if (e.key.startsWith("Arrow") && sel) {
        e.preventDefault();
        const s = byId(sel), before = snapshot(), step = e.shiftKey ? GRID * 4 : GRID;
        if (e.key === "ArrowLeft") s.x -= step;
        if (e.key === "ArrowRight") s.x += step;
        if (e.key === "ArrowUp") s.y -= step;
        if (e.key === "ArrowDown") s.y += step;
        draw(); commit(before);
        return;
      }
      if (!mod && !e.altKey) { const t = TOOLS.find((x) => x.key === e.key.toLowerCase()); if (t) setTool(t.tool); }
    };
    document.addEventListener("keydown", onKey, true);

    draw(); inspector(); touch();

    return {
      actions: el.querySelector(".sk-actions"),
      get: () => JSON.parse(snapshot()),
      isDirty: () => dirty,
      count: () => model.shapes.length,
      missingDescriptions: () => model.shapes.filter((s) => !String(s.desc || "").trim()).map((s) => s.n),
      markSaved() { saved = snapshot(); touch(); },
      /* A PNG picture of the sketch (no selection or grid), for Claude to look at. */
      png() {
        return new Promise((resolve) => {
          const src = sceneSvg(model, { forExport: true });
          const img = new Image();
          const url = URL.createObjectURL(new Blob([src], { type: "image/svg+xml" }));
          img.onload = () => {
            const c = document.createElement("canvas");
            c.width = model.frame.w + PAD * 2; c.height = model.frame.h + PAD * 2;
            c.getContext("2d").drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            resolve(c.toDataURL("image/png"));
          };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
          img.src = url;
        });
      },
      destroy() { document.removeEventListener("keydown", onKey, true); },
    };
  }

  window.SketchEditor = { mount, FRAMES };
})();
