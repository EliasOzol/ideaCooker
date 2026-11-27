/* Cooker page: Idea Cooker's flow inside IdeaMesh. A short description goes in, Claude asks design
   questions, then cooks the idea (README + prototype) or changes it, with the chat resumed each time.
   The panel shows the prototype, README, architecture and the UI sketch. An approved sketch is the
   check that lets an idea run through the mesh. Uses $, esc, api, toast, ago and showPage from index.html. */
(function () {
  const css = `
  .cooker { height: calc(100vh - 56px); }
  .ck { height: 100%; display: grid; grid-template-columns: 240px minmax(320px, 400px) minmax(0, 1fr); }
  .ck.focus { grid-template-columns: 240px 0 minmax(0, 1fr); }
  .ck.focus .ck-chat { visibility: hidden; }
  .ck-list, .ck-chat { border-right: 1px solid var(--line); min-height: 0; display: flex; flex-direction: column; }
  .ck-list { background: var(--surface); }
  .ck-list-head { padding: 16px; }
  .ck-list-head .btn { width: 100%; }
  .ck-ideas { list-style: none; margin: 0; padding: 0 8px 16px; overflow: auto; flex: 1; }
  .ck-idea { width: 100%; display: grid; grid-template-columns: 16px 1fr; gap: 0 8px; align-items: center; padding: 8px; border: 0; border-radius: var(--radius); background: none; text-align: left; cursor: pointer; transition: background var(--ease); }
  .ck-idea:hover { background: var(--accent-soft); }
  .ck-idea[aria-current="true"] { background: var(--raised); box-shadow: inset 0 0 0 1px var(--line); }
  .ck-idea .ring { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--ring, var(--line-strong)); }
  .ck-idea .t { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ck-idea .d { grid-column: 2; color: var(--muted); font-size: 12px; line-height: 16px; }
  .ck-idea.new .t { color: var(--accent); }

  .ck-chat { background: var(--bg); }
  .ck-chat-head { padding: 16px 24px; border-bottom: 1px solid var(--line); }
  .ck-chat-head h1 { margin: 0; font-size: 18px; line-height: 24px; }
  .ck-chat-head p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
  .ck-msgs { flex: 1; overflow: auto; padding: 16px 24px; display: grid; align-content: start; gap: 16px; }
  .msg { line-height: 22px; overflow-wrap: anywhere; }
  .msg p { margin: 0 0 8px; } .msg p:last-child { margin: 0; }
  .msg code { font: 13px/20px ui-monospace, Consolas, monospace; background: var(--sunk); padding: 0 4px; border-radius: 4px; }
  .msg.user { justify-self: end; max-width: 88%; padding: 8px 16px; border-radius: var(--radius); background: var(--accent-soft); }
  .msg.note { justify-self: center; color: var(--muted); font-size: 13px; }
  .msg.error { color: var(--red); }
  .msg .answers { margin: 8px 0 0; padding: 0; list-style: none; font-size: 13px; color: var(--muted); }
  .tools { margin: 8px 0 0; padding: 0; list-style: none; color: var(--muted); font-size: 12px; line-height: 18px; }
  .working { color: var(--muted); }
  .working b { color: var(--ink); font-weight: 600; }
  .ck-empty { color: var(--muted); }

  .qs { display: grid; gap: 16px; padding: 16px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); }
  .qs h2 { margin: 0; font-size: 15px; line-height: 24px; }
  .q { display: grid; gap: 8px; }
  .q .qt { font-weight: 600; }
  .opts { display: flex; flex-wrap: wrap; gap: 8px; }
  .opt { padding: 4px 16px; min-height: 32px; border-radius: 16px; border: 1px solid var(--line); background: var(--raised); cursor: pointer; text-align: left; transition: background var(--ease), border-color var(--ease); }
  .opt:hover { border-color: var(--line-strong); }
  .opt[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .own { height: 32px; padding: 0 8px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--raised); }
  .plan { width: 100%; min-height: 120px; padding: 8px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--raised); font: 12px/18px ui-monospace, Consolas, monospace; resize: vertical; }
  .qs-actions { display: flex; flex-wrap: wrap; gap: 8px; }

  .composer { padding: 16px 24px 24px; border-top: 1px solid var(--line); display: grid; gap: 8px; }
  .composer textarea { min-height: 80px; max-height: 240px; padding: 8px 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--raised); resize: vertical; line-height: 22px; transition: border-color var(--ease); }
  .composer textarea:hover { border-color: var(--line-strong); }
  .composer-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .composer-row .grow { flex: 1; }
  .check { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; cursor: pointer; }

  .ck-panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--surface); }
  .ck-tabs { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--line); }
  .ck-tab { height: 32px; padding: 0 16px; border: 0; border-radius: var(--radius); background: none; color: var(--muted); cursor: pointer; transition: background var(--ease), color var(--ease); }
  .ck-tab:hover { color: var(--ink); background: var(--accent-soft); }
  .ck-tab[aria-selected="true"] { color: var(--ink); background: var(--raised); font-weight: 600; box-shadow: inset 0 0 0 1px var(--line); }
  .ck-tabs .grow { flex: 1; }
  .ck-body { flex: 1; min-height: 0; overflow: auto; position: relative; }
  .ck-body.flush { overflow: hidden; }
  .ck-body .pad { padding: 24px 32px; max-width: 760px; }
  .ck-frame { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
  .ck-proto { height: 100%; display: flex; flex-direction: column; }
  .ck-proto-bar { display: flex; gap: 16px; padding: 8px 16px; font-size: 13px; border-bottom: 1px solid var(--line); }
  .ck-proto-bar a { color: var(--muted); text-decoration: none; }
  .ck-proto-bar a:hover { color: var(--ink); text-decoration: underline; }
  .ck-proto .ck-frame { flex: 1; height: auto; }
  .md h1 { font-size: 24px; line-height: 32px; margin: 0 0 8px; } .md h2 { font-size: 18px; line-height: 24px; margin: 24px 0 8px; } .md h3 { font-size: 15px; margin: 16px 0 8px; }
  .md p, .md ul { margin: 0 0 8px; line-height: 22px; } .md blockquote { margin: 0 0 16px; color: var(--muted); font-size: 16px; }
  .md pre { padding: 8px 16px; border-radius: var(--radius); background: var(--sunk); overflow: auto; font: 12px/18px ui-monospace, Consolas, monospace; }
  .md code { font: 13px/20px ui-monospace, Consolas, monospace; } .md a { color: var(--accent); }
  .md .mermaid { margin: 16px 0; } .md .mermaid svg { max-width: 100%; height: auto; }
  .ck-body .sk { height: 100%; }

  .gate { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 16px; border-top: 1px solid var(--line); }
  .gate .state { flex: 1; min-width: 200px; font-size: 13px; }
  .gate .state b { font-weight: 600; }
  .gate .pass { color: var(--green); } .gate .fail { color: var(--muted); }

  @media (max-width: 900px) {
    .cooker { height: auto; }
    .ck, .ck.focus { grid-template-columns: 1fr; }
    .ck.focus .ck-chat { visibility: visible; }
    .ck-list, .ck-chat { border-right: 0; border-bottom: 1px solid var(--line); }
    .ck-ideas { max-height: 200px; }
    .ck-msgs { max-height: 60vh; }
    .ck-panel { min-height: 640px; }
    #ckFocus { display: none; }
  }`;
  document.head.appendChild(Object.assign(document.createElement("style"), { textContent: css }));

  const STATUS_RING = { red: "var(--red)", yellow: "var(--yellow)", green: "var(--green)" };
  const STATUS_WORD = { red: "Idea", yellow: "Prototype", green: "Done" };
  const st = {
    ideas: [], folder: null, messages: [], tab: "prototype", previewPort: null, push: false,
    job: null, questions: null, askFirst: true, sketch: null, loaded: false, draft: "",
  };
  const root = document.getElementById("cookerPage");
  const idea = () => st.ideas.find((i) => i.folder === st.folder) || null;
  const busy = () => !!st.job;

  root.innerHTML = `
    <div class="ck" id="ck">
      <aside class="ck-list" aria-label="Ideas">
        <div class="ck-list-head"><button class="btn primary" id="ckNew">New idea</button></div>
        <ol class="ck-ideas" id="ckIdeas"></ol>
      </aside>
      <section class="ck-chat" aria-label="Chat">
        <div class="ck-chat-head" id="ckHead"></div>
        <div class="ck-msgs" id="ckMsgs" aria-live="polite"></div>
        <form class="composer" id="ckForm">
          <label for="ckInput" hidden>Message</label>
          <textarea id="ckInput"></textarea>
          <div class="composer-row">
            <label class="check"><input type="checkbox" id="ckAsk" checked> Ask design questions first</label>
            <span class="grow"></span>
            <button type="button" class="btn" id="ckSave" hidden title="Write only the README, no prototype">Save idea</button>
            <button class="btn primary" id="ckSend">Send</button>
          </div>
        </form>
      </section>
      <section class="ck-panel" aria-label="Idea panel">
        <div class="ck-tabs" role="tablist">
          <button class="ck-tab" role="tab" data-tab="prototype">Prototype</button>
          <button class="ck-tab" role="tab" data-tab="readme">README</button>
          <button class="ck-tab" role="tab" data-tab="arch">Architecture</button>
          <button class="ck-tab" role="tab" data-tab="sketch">Sketch</button>
          <span class="grow"></span>
          <button class="ck-tab" id="ckFocus" aria-pressed="false" title="Hide the chat to give the panel more room">Wider</button>
        </div>
        <div class="ck-body" id="ckBody"></div>
        <div class="gate" id="ckGate"></div>
      </section>
    </div>`;
  const el = (id) => document.getElementById(id);

  /* ---------- text helpers ---------- */
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  function paras(text) {
    return String(text || "").split(/\n{2,}/).map((p) => `<p>${inline(p).replace(/\n/g, "<br>")}</p>`).join("");
  }
  /** Small Markdown renderer for READMEs: headings, lists, checkboxes, quotes, code and mermaid blocks. */
  function markdown(text) {
    const out = [];
    const lines = String(text).replace(/\r\n/g, "\n").split("\n");
    let list = false;
    const close = () => { if (list) { out.push("</ul>"); list = false; } };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const fence = l.match(/^```(\w*)/);
      if (fence) {
        close();
        const body = [];
        for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
        out.push(fence[1] === "mermaid" ? `<div class="mermaid">${esc(body.join("\n"))}</div>` : `<pre><code>${esc(body.join("\n"))}</code></pre>`);
        continue;
      }
      let m;
      if ((m = l.match(/^(#{1,3})\s+(.*)/))) { close(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
      else if ((m = l.match(/^\s*[-*]\s+(\[( |x)\]\s+)?(.*)/))) {
        if (!list) { out.push("<ul>"); list = true; }
        out.push(`<li>${m[1] ? (m[2] === "x" ? "Done: " : "To do: ") : ""}${inline(m[3])}</li>`);
      }
      else if ((m = l.match(/^>\s?(.*)/))) { close(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); }
      else if (l.trim()) { close(); out.push(`<p>${inline(l)}</p>`); }
      else close();
    }
    close();
    return out.join("\n");
  }
  let mermaidReady = null;
  function renderMermaid(container) {
    const nodes = container.querySelectorAll(".mermaid");
    if (!nodes.length) return;
    mermaidReady ??= new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement("script"), { src: "/vendor/mermaid.min.js" });
      s.onload = () => {
        window.mermaid.initialize({ startOnLoad: false, theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "neutral", securityLevel: "strict" });
        resolve();
      };
      s.onerror = () => reject(new Error("Mermaid isn't installed in Idea Cooker (npm install)."));
      document.head.appendChild(s);
    });
    mermaidReady.then(() => window.mermaid.run({ nodes })).catch((e) => nodes.forEach((n) => (n.outerHTML = `<pre><code>${esc(n.textContent)}</code></pre><p class="ck-empty">${esc(e.message)}</p>`)));
  }

  /* ---------- data ---------- */
  async function loadIdeas() {
    const r = await api("/api/cooker/ideas");
    st.ideas = r.ideas;
    st.previewPort = r.previewPort;
    st.push = r.push;
    if (r.busy && !st.job) st.foreignBusy = true; else st.foreignBusy = false;
    renderList();
    renderGate();
  }
  async function loadChat() {
    st.messages = st.folder ? (await api(`/api/cooker/chat/${encodeURIComponent(st.folder)}`)).messages : [];
    renderChat();
  }

  /* ---------- jobs ---------- */
  async function runJob(label, start) {
    if (busy()) return null;
    let jobId;
    try {
      ({ jobId } = await start());
    } catch (e) {
      toast(e.message);
      return null;
    }
    st.job = { id: jobId, label, events: [], startedAt: Date.now() };
    renderChat();
    syncControls();
    for (;;) {
      await new Promise((r) => setTimeout(r, 900));
      let job;
      try {
        job = await api(`/api/cooker/jobs/${jobId}`);
      } catch {
        continue;
      }
      st.job.events = job.events;
      renderWorking();
      if (job.state !== "running") {
        st.job = null;
        if (job.state === "error") toast(job.error);
        syncControls();
        return job;
      }
    }
  }

  /* ---------- list ---------- */
  function renderList() {
    const items = [`<li><button class="ck-idea new" data-folder="" aria-current="${!st.folder}"><span class="ring" style="--ring:var(--accent)"></span><span class="t">New idea</span><span class="d">Describe it in a sentence or two</span></button></li>`];
    for (const i of st.ideas) {
      const check = i.check?.approved ? " · sketch approved" : "";
      items.push(`<li><button class="ck-idea" data-folder="${esc(i.folder)}" aria-current="${st.folder === i.folder}" style="--ring:${STATUS_RING[i.status] || "var(--line-strong)"}">
        <span class="ring" aria-hidden="true"></span><span class="t">${esc(i.title.replace(/[^\p{L}\p{N}\s.,:'&+()-]/gu, "").trim() || i.folder)}</span>
        <span class="d">${esc(i.date)} · ${STATUS_WORD[i.status] || "No status"}${check}</span></button></li>`);
    }
    el("ckIdeas").innerHTML = items.join("");
    el("ckIdeas").querySelectorAll(".ck-idea").forEach((b) => b.addEventListener("click", () => select(b.dataset.folder || null)));
  }

  async function select(folder) {
    if (st.sketch?.editor.isDirty() && !confirm("The sketch has unsaved changes. Leave without saving?")) return;
    st.folder = folder;
    st.questions = null;
    dropSketch();
    renderList();
    await loadChat();
    const i = idea();
    setTab(i && !i.entry ? (i.hasSketch ? "sketch" : "readme") : "prototype");
  }

  /* ---------- chat ---------- */
  function renderHead() {
    const i = idea();
    el("ckHead").innerHTML = i
      ? `<h1>${esc(i.title.replace(/[^\p{L}\p{N}\s.,:'&+()-]/gu, "").trim() || i.folder)}</h1><p>${esc(i.folder)} · ${esc(i.statusText || STATUS_WORD[i.status] || "")}</p>`
      : `<h1>New idea</h1><p>A short description is enough. Claude asks what it needs to know before it builds.</p>`;
    el("ckInput").placeholder = i ? "What should change?" : "An app that…";
    el("ckSave").hidden = !!i;
  }

  function renderChat() {
    renderHead();
    const parts = [];
    if (!st.messages.length && !st.questions && !st.job) {
      parts.push(`<p class="ck-empty">${st.folder ? "No chat for this idea yet. Ask for a change, or draft a sketch in the Sketch tab." : "Write the idea below. You'll get a few design questions, then a README and a working prototype."}</p>`);
    }
    for (const m of st.messages) {
      if (m.role === "note") { parts.push(`<div class="msg note">${esc(m.text)}</div>`); continue; }
      if (m.role === "user") {
        parts.push(`<div class="msg user">${paras(m.text)}${m.answers?.length ? `<ul class="answers">${m.answers.map((a) => `<li>${esc(a.question)}: ${esc(a.answer)}</li>`).join("")}</ul>` : ""}</div>`);
        continue;
      }
      parts.push(`<div class="msg${m.error ? " error" : ""}">${paras(m.text)}${m.tools?.length ? `<ul class="tools">${m.tools.slice(-8).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}</div>`);
    }
    if (st.questions) parts.push(questionsHtml());
    parts.push(`<div id="ckWorking"></div>`);
    el("ckMsgs").innerHTML = parts.join("");
    if (st.questions) bindQuestions();
    renderWorking();
    el("ckMsgs").scrollTop = el("ckMsgs").scrollHeight;
  }

  function renderWorking() {
    const w = el("ckWorking");
    if (!w) return;
    if (!st.job) { w.innerHTML = ""; return; }
    const secs = Math.round((Date.now() - st.job.startedAt) / 1000);
    const tools = st.job.events.filter((e) => e.kind === "tool").slice(-5);
    w.innerHTML = `<div class="msg working"><b>${esc(st.job.label)}</b> · ${secs}s${tools.length ? `<ul class="tools">${tools.map((t) => `<li>${esc(t.text)}</li>`).join("")}</ul>` : ""}</div>`;
    el("ckMsgs").scrollTop = el("ckMsgs").scrollHeight;
  }

  /* ---------- design questions ---------- */
  function questionsHtml() {
    const q = st.questions;
    const isNew = !q.folder;
    return `<form class="qs" id="ckQs">
      <h2>${esc(q.note || "A few questions before Claude builds")}</h2>
      ${q.questions.map((x, n) => `<div class="q" role="group" aria-labelledby="q${n}">
        <div class="qt" id="q${n}">${esc(x.question)}</div>
        <div class="opts">${x.options.map((o) => `<button type="button" class="opt" data-q="${n}" aria-pressed="false">${esc(o)}</button>`).join("")}</div>
        <input class="own" data-own="${n}" placeholder="Or your own answer" aria-label="Your own answer to: ${esc(x.question)}">
      </div>`).join("")}
      ${q.diagram ? `<div class="q"><label class="qt" for="ckPlan">Planned architecture (edit it before building)</label><textarea class="plan" id="ckPlan">${esc(q.diagram)}</textarea></div>` : ""}
      <div class="qs-actions">
        <button class="btn primary" id="ckBuild">${isNew ? "Cook it" : "Build it"}</button>
        ${isNew ? `<button type="button" class="btn" id="ckQsSave">Save idea without a prototype</button>` : ""}
        <button type="button" class="btn" id="ckQsCancel">Cancel</button>
      </div>
    </form>`;
  }

  function bindQuestions() {
    const form = el("ckQs");
    const multiple = (n) => st.questions.questions[n].multiple;
    form.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      if (!multiple(+b.dataset.q)) form.querySelectorAll(`.opt[data-q="${b.dataset.q}"]`).forEach((o) => o.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", String(on));
    }));
    const collect = () => st.questions.questions.map((x, n) => {
      const picked = [...form.querySelectorAll(`.opt[data-q="${n}"][aria-pressed="true"]`)].map((b) => b.textContent);
      const own = form.querySelector(`[data-own="${n}"]`).value.trim();
      return { question: x.question, answer: [...picked, own].filter(Boolean).join("; ") };
    }).filter((a) => a.answer);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      build({ answers: collect(), plan: el("ckPlan")?.value || "" });
    });
    el("ckQsSave")?.addEventListener("click", () => build({ answers: collect(), saveOnly: true }));
    el("ckQsCancel").addEventListener("click", () => {
      el("ckInput").value = st.questions.text;
      st.questions = null;
      renderChat();
    });
  }

  /* ---------- sending ---------- */
  async function send({ saveOnly = false } = {}) {
    const text = el("ckInput").value.trim();
    if (!text || busy()) return;
    const folder = st.folder;
    if (!saveOnly && el("ckAsk").checked) {
      el("ckInput").value = "";
      st.pendingText = text;
      st.messages.push({ role: "user", text, at: new Date().toISOString(), local: true });
      const job = await runJob("Reading and preparing questions", () => api("/api/cooker/questions", { method: "POST", body: JSON.stringify({ folder, message: text }) }));
      st.messages = st.messages.filter((m) => !m.local);
      if (job?.state !== "done") { el("ckInput").value = text; renderChat(); return; }
      const r = job.result;
      if (r.error || !r.questions?.length) {
        if (r.error) toast(r.error);
        st.questions = { text, folder, questions: [], diagram: r.diagram || "" };
        return build({ answers: [], plan: r.diagram || "" });
      }
      st.questions = { text, folder, ...r };
      renderChat();
      el("ckQs")?.querySelector(".opt")?.focus();
      return;
    }
    el("ckInput").value = "";
    st.questions = { text, folder, questions: [] };
    build({ saveOnly });
  }

  async function build({ answers = [], plan = "", saveOnly = false }) {
    const q = st.questions;
    st.questions = null;
    st.messages.push({ role: "user", text: q.text, answers, at: new Date().toISOString(), local: true });
    const label = q.folder ? "Claude is changing the idea" : saveOnly ? "Claude is writing the README" : "Claude is cooking the idea";
    const job = await runJob(label, () => api("/api/cooker/chat", { method: "POST", body: JSON.stringify({ folder: q.folder, message: q.text, answers, plan, saveOnly }) }));
    st.messages = st.messages.filter((m) => !m.local);
    if (job?.state === "done") {
      await loadIdeas();
      if (!q.folder) {
        st.folder = job.result.folder;
        renderList();
      }
      await loadChat();
      const i = idea();
      if (job.result.committed) toast(job.result.pushed ? "Committed and pushed" : "Committed locally");
      dropSketch();
      setTab(i?.entry ? "prototype" : "readme", true);
    } else {
      if (job?.state === "error" && !q.folder) el("ckInput").value = q.text;
      await loadChat();
    }
  }

  /* ---------- panel ---------- */
  function setTab(tab, force = false) {
    if (st.tab === "sketch" && tab !== "sketch" && st.sketch?.editor.isDirty() && !confirm("The sketch has unsaved changes. Leave the Sketch tab without saving?")) return;
    if (tab !== "sketch") dropSketch();
    st.tab = tab;
    root.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === tab)));
    renderPanel(force);
    renderGate();
  }

  function renderPanel(force) {
    const body = el("ckBody");
    const i = idea();
    const key = `${st.tab}:${st.folder}:${i?.files?.join(",")}`;
    if (!force && body.dataset.key === key) return;
    body.dataset.key = key;
    body.classList.toggle("flush", st.tab === "prototype" || st.tab === "sketch");
    if (!i) {
      body.innerHTML = `<div class="pad"><p class="ck-empty">The prototype, README, architecture and sketch of the idea show up here once it's cooked.</p></div>`;
      return;
    }
    if (st.tab === "prototype") {
      const site = i.site ? `<a href="/site/${encodeURIComponent(i.folder)}/" target="_blank" rel="noopener">Generated web page</a>` : "";
      if (!i.entry) {
        body.innerHTML = `<div class="pad"><p class="ck-empty">No prototype yet. Ask for one in the chat, for example "Build a first prototype".</p>${site ? `<p>${site}</p>` : ""}</div>`;
        return;
      }
      const src = `http://${location.hostname}:${st.previewPort}/${encodeURIComponent(i.folder)}/${encodeURI(i.entry)}`;
      body.innerHTML = `<div class="ck-proto">
        <div class="ck-proto-bar"><a href="${esc(src)}" target="_blank" rel="noopener">Open in new tab</a>${site}</div>
        <iframe class="ck-frame" src="${esc(src)}" title="Prototype of ${esc(i.folder)}" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-same-origin"></iframe>
      </div>`;
      return;
    }
    if (st.tab === "readme" || st.tab === "arch") {
      body.innerHTML = `<div class="pad"><p class="ck-empty">Loading…</p></div>`;
      api(`/api/cooker/file/${encodeURIComponent(i.folder)}?which=${st.tab === "arch" ? "arch" : "readme"}`)
        .then((r) => {
          if (body.dataset.key !== key) return;
          body.innerHTML = `<div class="pad md">${markdown(r.text)}</div>`;
          renderMermaid(body);
        })
        .catch(() => {
          if (body.dataset.key !== key) return;
          body.innerHTML = `<div class="pad"><p class="ck-empty">${st.tab === "arch" ? "No architecture yet. Claude writes ARCHITECTURE.md when a prototype has several parts." : "No README."}</p></div>`;
        });
      return;
    }
    renderSketch(i, body);
  }

  /* ---------- sketch (Idea Cooker's editor) ---------- */
  function dropSketch() {
    st.sketch?.editor.destroy();
    st.sketch = null;
  }

  function renderSketch(i, body) {
    dropSketch();
    body.innerHTML = `<div class="pad"><p class="ck-empty">Loading the sketch…</p></div>`;
    const key = body.dataset.key;
    const load = i.hasSketch ? api(`/api/cooker/sketch/${encodeURIComponent(i.folder)}`).then((r) => r.sketch).catch(() => null) : Promise.resolve(null);
    load.then((sketch) => {
      if (body.dataset.key !== key || !window.SketchEditor) return;
      const editor = window.SketchEditor.mount(body, sketch, { onDirty: () => { syncSketch(); renderGate(); } });
      st.sketch = { folder: i.folder, editor };
      editor.actions.innerHTML = `
        <button class="btn" type="button" id="skDraft" title="Claude lays out a first version from the idea; you edit it and save">Draft with Claude</button>
        <button class="btn" type="button" id="skSave">Save</button>
        <button class="btn" type="button" id="skReview" title="Claude looks at the sketch and replies in the chat">Ask for feedback</button>`;
      el("skDraft").addEventListener("click", draftSketch);
      el("skSave").addEventListener("click", saveSketch);
      el("skReview").addEventListener("click", reviewSketch);
      syncSketch();
    });
  }

  function syncSketch() {
    const sk = st.sketch;
    if (!sk || !el("skSave")) return;
    const empty = !sk.editor.count();
    el("skDraft").disabled = busy();
    el("skDraft").classList.toggle("primary", empty);
    el("skSave").disabled = busy() || empty || !sk.editor.isDirty();
    el("skSave").textContent = sk.editor.isDirty() ? "Save" : "Saved";
    el("skReview").disabled = busy() || empty;
  }

  async function draftSketch() {
    const sk = st.sketch;
    if (!sk || busy()) return;
    if (sk.editor.count() && !confirm("Replace the sketch in the editor with a new draft from Claude? You can undo it.")) return;
    const folder = sk.folder;
    const job = await runJob("Claude is drafting the sketch", () => api(`/api/cooker/sketch/${encodeURIComponent(folder)}/draft`, { method: "POST", body: "{}" }));
    if (job?.state === "done" && st.sketch?.folder === folder) st.sketch.editor.load(job.result.sketch);
    if (st.folder === folder) await loadChat();
    syncSketch();
    renderGate();
  }

  async function saveSketch() {
    const sk = st.sketch;
    if (!sk || busy()) return false;
    if (!sk.editor.isDirty()) return true;
    const sketch = sk.editor.get();
    const png = await sk.editor.png();
    const job = await runJob("Saving the sketch", () => api(`/api/cooker/sketch/${encodeURIComponent(sk.folder)}`, { method: "POST", body: JSON.stringify({ sketch, png }) }));
    if (job?.state !== "done") { syncSketch(); return false; }
    sk.editor.markSaved();
    await loadIdeas();
    await loadChat();
    syncSketch();
    return true;
  }

  async function reviewSketch() {
    if (!(await saveSketch())) return;
    if (el("ck").classList.contains("focus")) toggleFocus();
    const folder = st.folder;
    const text = "Look at my UI sketch and tell me what's unclear, missing or could go wrong before you build it.";
    st.messages.push({ role: "user", text, at: new Date().toISOString(), local: true });
    await runJob("Claude is reading the sketch", () => api("/api/cooker/chat", { method: "POST", body: JSON.stringify({ folder, message: text, mode: "review" }) }));
    if (st.folder === folder) await loadChat();
  }

  /* ---------- the check layer: sketch approved, then the mesh ---------- */
  function renderGate() {
    const g = el("ckGate");
    const i = idea();
    if (!i) { g.hidden = true; return; }
    g.hidden = false;
    const c = i.check || { approved: false, reason: "No sketch yet" };
    const dirty = !!st.sketch?.editor.isDirty();
    g.innerHTML = `
      <div class="state">Sketch approved: ${c.approved ? `<b class="pass">Passed</b>` : `<b class="fail">${esc(dirty ? "Unsaved changes" : c.reason)}</b>`}</div>
      <button class="btn" id="ckApprove" ${c.approved || !i.hasSketch || dirty || busy() ? "disabled" : ""}>${c.approved ? "Approved" : "Approve sketch"}</button>
      <button class="btn primary" id="ckMesh" ${!c.approved || busy() ? "disabled" : ""} title="${c.approved ? "Send this idea through the portfolio and website bricks" : "Approve the sketch first"}">Run through mesh</button>`;
    el("ckApprove").addEventListener("click", approve);
    el("ckMesh").addEventListener("click", runMesh);
  }

  async function approve() {
    const i = idea();
    try {
      i.check = await api(`/api/cooker/sketch/${encodeURIComponent(i.folder)}/approve`, { method: "POST", body: JSON.stringify({ approved: true }) });
      renderGate();
      renderList();
      await loadChat();
    } catch (e) { toast(e.message); }
  }

  async function runMesh() {
    const i = idea();
    try {
      await api(`/api/cooker/mesh/${encodeURIComponent(i.folder)}`, { method: "POST", body: "{}" });
      showPage("mesh");
      toast(`Running ${i.folder} through the mesh`);
    } catch (e) { toast(e.message); }
  }

  /* ---------- controls ---------- */
  function syncControls() {
    el("ckSend").disabled = busy() || !el("ckInput").value.trim();
    el("ckSave").disabled = busy() || !el("ckInput").value.trim();
    el("ckNew").disabled = busy();
    syncSketch();
    renderGate();
  }
  function toggleFocus() {
    const on = el("ck").classList.toggle("focus");
    el("ckFocus").setAttribute("aria-pressed", String(on));
    el("ckFocus").textContent = on ? "Show chat" : "Wider";
  }

  el("ckForm").addEventListener("submit", (e) => { e.preventDefault(); send(); });
  el("ckSave").addEventListener("click", () => send({ saveOnly: true }));
  el("ckInput").addEventListener("input", syncControls);
  el("ckInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  el("ckNew").addEventListener("click", () => select(null).then(() => el("ckInput").focus()));
  el("ckFocus").addEventListener("click", toggleFocus);
  root.querySelectorAll("[data-tab]").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));
  setInterval(() => st.job && renderWorking(), 1000);

  window.Cooker = {
    async show() {
      if (st.loaded) return loadIdeas().catch((e) => toast(e.message));
      st.loaded = true;
      try {
        await loadIdeas();
      } catch (e) {
        toast(`Can't load the ideas: ${e.message}`);
      }
      await select(st.folder);
    },
    /** From the Mesh page: start a new idea with this short description, asking the design questions first. */
    async startNew(text) {
      await this.show();
      await select(null);
      el("ckInput").value = text;
      el("ckAsk").checked = true;
      syncControls();
      send();
    },
  };
})();
