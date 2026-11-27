import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { inspectRepo, pullIfRemote, commitAndPush } from "./lib/git.mjs";
import { listIdeas, updateIdeaStatus, STATUSES } from "./lib/ideas.mjs";
import { cookIdea, reviseIdea, describeImport, describeLinked, askQuestions, today } from "./lib/generate.mjs";
import { importIntoRepo, kebab } from "./lib/importer.mjs";
import { chatStore } from "./lib/chats.mjs";
import { parseRepoUrl, readLink, writeLink, ensureClone, cloneDir, firstCommitDate, commitClone, staticEntry } from "./lib/linked.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4321);
// Prototypes are served from a second port (a different origin), so their scripts can't call this app's API.
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT || PORT + 1);
const CONFIG_FILE = process.env.IDEA_COOKER_CONFIG || path.join(here, "config.json");
const chats = chatStore(process.env.IDEA_COOKER_CHATS || path.join(here, "chats"));
const PUBLIC_DIR = path.join(here, "public");
// Clones of linked repos (git-ignored). Claude edits these, and the app pushes them to the original repos.
const REPOS_DIR = process.env.IDEA_COOKER_REPOS || path.join(here, "repos");
const FOLDER_RE = /^\d{4}-\d{2}-\d{2}-[\w.-]+$/;
const DEMO_FILE = "demo.html"; // dummy-data demo for linked repos that can't be previewed as they are
const ARCH_FILE = "ARCHITECTURE.md"; // Mermaid diagrams of the idea's design; Claude and the user both edit it
const MERMAID_JS = path.join(here, "node_modules", "mermaid", "dist", "mermaid.min.js");

// ---------- config ----------
async function loadConfig() {
  try {
    return { push: true, model: "", askQuestions: "always", ...JSON.parse(await fs.readFile(CONFIG_FILE, "utf8")) };
  } catch {
    return { repoPath: "", confirmed: false, push: true, model: "" };
  }
}
async function saveConfig(cfg) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}
/** Rule sets: [{ id, title, text, enabled }], written by the user in Settings and added to Claude's prompts. */
function cleanRules(list) {
  if (list.length > 20) throw httpError(400, "That's more than 20 rule sets.");
  return list
    .map((r) => ({
      id: /^[\w-]{1,40}$/.test(String(r?.id || "")) ? String(r.id) : randomUUID().slice(0, 8),
      title: String(r?.title || "").trim().slice(0, 60),
      text: String(r?.text || "").trim().slice(0, 8000),
      enabled: r?.enabled !== false,
    }))
    .filter((r) => r.title || r.text);
}
const activeRules = (cfg) => (cfg.rules || []).filter((r) => r.enabled && r.text);

/** Answers to the pre-build questions and the approved planned diagram, as sent by the page. */
function cleanDesign(answers, plan) {
  const list = Array.isArray(answers) ? answers.slice(0, 20) : [];
  return {
    answers: list
      .map((a) => ({ question: String(a?.question || "").slice(0, 500).trim(), answer: String(a?.answer || "").slice(0, 2000).trim() }))
      .filter((a) => a.question && a.answer),
    plan: typeof plan === "string" && plan.trim() ? plan.slice(0, 30_000) : "",
  };
}

async function requireRepo() {
  const cfg = await loadConfig();
  if (!cfg.repoPath || !cfg.confirmed) throw httpError(409, "Set and confirm your ideas repository in Settings first.");
  return cfg;
}
function checkFolder(folder) {
  if (!FOLDER_RE.test(folder)) throw httpError(400, "Bad idea folder");
  return folder;
}

// ---------- jobs (one at a time, so two runs never race on the same repo) ----------
const jobs = new Map();
let busy = null;

function startJob(kind, meta, fn) {
  if (busy) throw httpError(409, "Claude is still working on the last request.");
  const job = { id: randomUUID(), kind, ...meta, state: "running", log: [], events: [], startedAt: Date.now(), result: null, error: null };
  const log = (line) => {
    job.log.push(`${new Date().toLocaleTimeString()}  ${line}`);
    console.log(`[${kind}] ${line}`);
  };
  const emit = (ev) => job.events.push(ev);
  jobs.set(job.id, job);
  busy = job.id;
  fn({ log, emit, job })
    .then((r) => Object.assign(job, { state: "done", result: r }))
    .catch((e) => {
      log(`Error: ${e.message}`);
      Object.assign(job, { state: "error", error: e.message });
    })
    .finally(() => (busy = null));
  return job;
}

const toolsOf = (job) => job.events.filter((e) => e.kind === "tool").map((e) => e.text);
const now = () => new Date().toISOString();

// ---------- http helpers ----------
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}
async function readJson(req) {
  let raw = "";
  for await (const c of req) {
    raw += c;
    if (raw.length > 100_000) throw httpError(413, "Body too large");
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw httpError(400, "Invalid JSON");
  }
}
const MIME = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".md": "text/plain; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".py": "text/plain; charset=utf-8", ".ino": "text/plain; charset=utf-8" };
async function serveFile(res, baseDir, rel) {
  const base = path.resolve(baseDir);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw httpError(403, "Forbidden");
  const data = await fs.readFile(abs).catch(() => null);
  if (!data) throw httpError(404, "Not found");
  res.writeHead(200, { "content-type": MIME[path.extname(abs).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
  res.end(data);
}

/** The file the preview panel opens: index.html, else the first top-level .html file. */
function entryOf(files) {
  return files.find((f) => f.toLowerCase() === "index.html") || files.find((f) => /\.html?$/i.test(f)) || null;
}

// ---------- routes ----------
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = decodeURIComponent(url.pathname);

  // Same-origin guard for state-changing calls. Prototypes run on PREVIEW_PORT, so they're blocked here too.
  if (req.method !== "GET") {
    const origin = req.headers.origin;
    if (origin && origin !== `http://localhost:${PORT}` && origin !== `http://127.0.0.1:${PORT}`) throw httpError(403, "Cross-origin request blocked");
  }

  if (req.method === "GET" && (p === "/" || p === "/index.html")) return serveFile(res, PUBLIC_DIR, "index.html");

  if (req.method === "GET" && p === "/api/config") {
    const cfg = await loadConfig();
    const repo = cfg.repoPath ? await inspectRepo(cfg.repoPath).catch((e) => ({ ok: false, error: e.message })) : null;
    const host = (req.headers.host || "").split(":")[0] || "localhost";
    return send(res, 200, { ...cfg, repo, statuses: STATUSES, busy, previewOrigin: `http://${host}:${PREVIEW_PORT}` });
  }

  if (req.method === "POST" && p === "/api/repo/check") {
    const { repoPath } = await readJson(req);
    if (!repoPath) throw httpError(400, "repoPath is required");
    const stat = await fs.stat(repoPath).catch(() => null);
    if (!stat?.isDirectory()) return send(res, 200, { ok: false, error: "Folder not found." });
    const info = await inspectRepo(repoPath);
    if (info.ok) info.ideas = (await listIdeas(repoPath)).length;
    return send(res, 200, info);
  }

  // Saving the path IS the user's confirmation; nothing is written to a repo before this.
  if (req.method === "POST" && p === "/api/config") {
    const body = await readJson(req);
    const cfg = await loadConfig();
    if (typeof body.repoPath === "string") {
      const info = await inspectRepo(body.repoPath);
      if (!info.ok) throw httpError(400, info.error);
      cfg.repoPath = info.toplevel.replaceAll("/", path.sep);
      cfg.confirmed = true;
    }
    if (typeof body.push === "boolean") cfg.push = body.push;
    if (typeof body.model === "string") cfg.model = body.model.trim();
    if (Array.isArray(body.rules)) cfg.rules = cleanRules(body.rules);
    if (typeof body.allowCommands === "boolean") cfg.allowCommands = body.allowCommands;
    if (["always", "new", "never"].includes(body.askQuestions)) cfg.askQuestions = body.askQuestions;
    await saveConfig(cfg);
    return send(res, 200, cfg);
  }

  if (req.method === "GET" && p === "/api/ideas") {
    const cfg = await loadConfig();
    if (!cfg.repoPath || !cfg.confirmed) return send(res, 200, []);
    const ideas = await listIdeas(cfg.repoPath);
    const appFolder = path.relative(path.resolve(cfg.repoPath), path.resolve(here)).split(path.sep)[0];
    for (const i of ideas) {
      i.hasChat = await chats.has(i.folder);
      i.isApp = i.folder === appFolder;
      i.hasArch = i.files.includes(ARCH_FILE);
      const link = await readLink(cfg.repoPath, i.folder);
      if (link) {
        const repo = parseRepoUrl(link.repo);
        const dir = cloneDir(REPOS_DIR, repo);
        const cloned = !!(await fs.stat(path.join(dir, ".git")).catch(() => null));
        i.repo = { label: repo.label, web: repo.web, cloned };
        // Preview: the project's own static page if it has one, else the dummy-data demo in the idea folder.
        i.entry = (cloned ? await staticEntry(dir) : null) || (i.files.includes(DEMO_FILE) ? DEMO_FILE : null);
        i.hasRepoReadme = cloned && !!(await fs.stat(path.join(dir, "README.md")).catch(() => null));
      } else {
        i.entry = entryOf(i.files);
      }
    }
    return send(res, 200, ideas);
  }

  let m;
  if (req.method === "GET" && (m = p.match(/^\/api\/ideas\/([\w.-]+)\/readme$/))) {
    const cfg = await requireRepo();
    const folder = checkFolder(m[1]);
    let file = path.join(cfg.repoPath, folder, "README.md");
    if (url.searchParams.get("which") === "arch") file = path.join(cfg.repoPath, folder, ARCH_FILE);
    if (url.searchParams.get("which") === "repo") {
      const link = await readLink(cfg.repoPath, folder);
      if (!link) throw httpError(404, "This idea has no linked repo");
      file = path.join(cloneDir(REPOS_DIR, parseRepoUrl(link.repo)), "README.md");
    }
    const text = await fs.readFile(file, "utf8").catch(() => null);
    if (text === null) throw httpError(404, "No README");
    return send(res, 200, { text });
  }

  // Link an existing repo as an idea: clone it, write the idea README, commit + push the ideas repo.
  if (req.method === "POST" && p === "/api/link") {
    const cfg = await requireRepo();
    const { source } = await readJson(req);
    let repo;
    try {
      repo = parseRepoUrl(source);
    } catch (e) {
      throw httpError(400, e.message);
    }
    for (const i of await listIdeas(cfg.repoPath)) {
      const l = await readLink(cfg.repoPath, i.folder);
      if (l && parseRepoUrl(l.repo).key === repo.key) throw httpError(409, `${repo.label} is already linked as ${i.folder}.`);
    }
    const job = startJob("link", { folder: null, text: `Link ${repo.label}` }, async ({ log, emit, job }) => {
      await pullIfRemote(cfg.repoPath, log);
      const dir = await ensureClone(REPOS_DIR, repo, log);
      emit({ kind: "tool", text: `Cloned ${repo.label}` });
      const date = (await firstCommitDate(dir)) || today();
      const existing = new Set((await fs.readdir(cfg.repoPath)).map((n) => n.toLowerCase()));
      const slug = kebab(repo.name);
      let folder = `${date}-${slug}`;
      for (let n = 2; existing.has(folder.toLowerCase()); n++) folder = `${date}-${slug}-${n}`;
      await fs.mkdir(path.join(cfg.repoPath, folder));
      await writeLink(cfg.repoPath, folder, { repo: repo.web || repo.url });
      job.folder = folder;
      let r;
      try {
        r = await describeLinked({ repoPath: cfg.repoPath, folder, clone: dir, cloneLabel: repo.label, date, needsDemo: !(await staticEntry(dir)), model: cfg.model, rules: activeRules(cfg), allowCommands: !!cfg.allowCommands, log, emit });
      } catch (e) {
        // Remove the half-made folder this job just created, so linking can be retried.
        await fs.rm(path.join(cfg.repoPath, folder), { recursive: true, force: true }).catch(() => {});
        throw e;
      }
      const g = await commitAndPush(cfg.repoPath, [folder], `Link idea: ${folder}\n\nCode: ${repo.label}`, { push: cfg.push, log });
      await chats.append(folder, [
        { role: "user", text: `Link ${repo.label}`, at: now() },
        { role: "assistant", text: r.reply, tools: toolsOf(job), at: now() },
      ], r.sessionId);
      return { folder, reply: r.reply, ...g };
    });
    return send(res, 202, { jobId: job.id });
  }

  if (req.method === "GET" && (m = p.match(/^\/api\/chat\/([\w.-]+)$/))) {
    const chat = await chats.get(checkFolder(m[1]));
    return send(res, 200, { messages: chat.messages });
  }

  // One endpoint for the chat box: no folder = cook a new idea, a folder = change that idea.
  if (req.method === "POST" && p === "/api/chat") {
    const cfg = await requireRepo();
    const { folder, message, saveOnly, answers, plan } = await readJson(req);
    const text = String(message || "").trim();
    if (!text) throw httpError(400, "Write a message first.");
    const design = cleanDesign(answers, plan);
    const userMsg = () => ({ role: "user", text, at: now(), ...(design.answers.length ? { answers: design.answers } : {}), ...(design.plan ? { plan: true } : {}) });

    if (!folder) {
      const job = startJob("cook", { folder: null, text, saveOnly: !!saveOnly }, async ({ log, emit, job }) => {
        await pullIfRemote(cfg.repoPath, log);
        const r = await cookIdea({ repoPath: cfg.repoPath, idea: text, design, model: cfg.model, rules: activeRules(cfg), allowCommands: !!cfg.allowCommands, log, emit, saveOnly: !!saveOnly });
        job.folder = r.folder;
        log(`Created ${r.folder}/`);
        const g = await commitAndPush(cfg.repoPath, [r.folder], `${saveOnly ? "Saved idea" : "Daily idea"}: ${r.folder}\n\n${text.split("\n")[0].slice(0, 72)}`, { push: cfg.push, log });
        await chats.append(r.folder, [
          userMsg(),
          { role: "assistant", text: r.reply, tools: toolsOf(job), at: now() },
        ], r.sessionId);
        return { folder: r.folder, reply: r.reply, ...g };
      });
      return send(res, 202, { jobId: job.id });
    }

    checkFolder(folder);
    const exists = await fs.stat(path.join(cfg.repoPath, folder)).catch(() => null);
    if (!exists?.isDirectory()) throw httpError(404, "That idea doesn't exist.");
    const job = startJob("revise", { folder, text }, async ({ log, emit, job }) => {
      try {
        await pullIfRemote(cfg.repoPath, log);
        const chat = await chats.get(folder);
        const link = await readLink(cfg.repoPath, folder);
        const repo = link ? parseRepoUrl(link.repo) : null;
        const clone = repo ? await ensureClone(REPOS_DIR, repo, log) : null;
        const demo = clone ? { exists: !!(await fs.stat(path.join(cfg.repoPath, folder, DEMO_FILE)).catch(() => null)), projectEntry: await staticEntry(clone) } : null;
        const r = await reviseIdea({ repoPath: cfg.repoPath, folder, message: text, design, sessionId: chat.sessionId, demo, model: cfg.model, rules: activeRules(cfg), allowCommands: !!cfg.allowCommands, log, emit, clone, cloneLabel: repo?.label });
        const summary = text.split("\n")[0].slice(0, 72);
        let code = null;
        if (clone) code = await commitClone(clone, `${summary}\n\nMade with Idea Cooker.`, { push: cfg.push, log, label: repo.label });
        const g = await commitAndPush(cfg.repoPath, [folder], `Update ${folder}\n\n${summary}`, { push: cfg.push, log });
        await chats.append(folder, [
          userMsg(),
          { role: "assistant", text: r.reply, tools: toolsOf(job), at: now() },
        ], r.sessionId);
        return { folder, reply: r.reply, ...g, code };
      } catch (e) {
        await chats.append(folder, [
          userMsg(),
          { role: "assistant", text: e.message, error: true, tools: toolsOf(job), at: now() },
        ]);
        throw e;
      }
    });
    return send(res, 202, { jobId: job.id });
  }

  // Before building: Claude reads what it needs and returns design questions (and, for bigger builds,
  // a planned architecture diagram) for the user to answer and edit. Nothing is written or committed.
  if (req.method === "POST" && p === "/api/questions") {
    const cfg = await requireRepo();
    const { folder, message } = await readJson(req);
    const text = String(message || "").trim();
    if (!text) throw httpError(400, "Write a message first.");
    if (folder) checkFolder(folder);
    const job = startJob("questions", { folder: folder || null, text }, async ({ log }) => {
      const link = folder ? await readLink(cfg.repoPath, folder) : null;
      const repo = link ? parseRepoUrl(link.repo) : null;
      const clone = repo ? await ensureClone(REPOS_DIR, repo, log) : null;
      return askQuestions({ repoPath: cfg.repoPath, folder, message: text, clone, cloneLabel: repo?.label, model: cfg.model, rules: activeRules(cfg), log });
    });
    return send(res, 202, { jobId: job.id });
  }

  // The user edits ARCHITECTURE.md in the panel: save, commit, push, and note it in the chat for Claude.
  if (req.method === "POST" && (m = p.match(/^\/api\/ideas\/([\w.-]+)\/architecture$/))) {
    const cfg = await requireRepo();
    const folder = checkFolder(m[1]);
    const { content } = await readJson(req);
    const text = String(content ?? "");
    if (!text.trim()) throw httpError(400, "The diagram is empty.");
    if (text.length > 90_000) throw httpError(413, "That's too long.");
    if (!(await fs.stat(path.join(cfg.repoPath, folder)).catch(() => null))?.isDirectory()) throw httpError(404, "That idea doesn't exist.");
    const job = startJob("arch", { folder, text: "" }, async ({ log }) => {
      await pullIfRemote(cfg.repoPath, log);
      await fs.writeFile(path.join(cfg.repoPath, folder, ARCH_FILE), text.replace(/\r\n/g, "\n").trimEnd() + "\n", "utf8");
      log(`Saved ${folder}/${ARCH_FILE}`);
      const g = await commitAndPush(cfg.repoPath, [folder], `Edit architecture: ${folder}`, { push: cfg.push, log });
      if (g.committed) await chats.append(folder, [{ role: "note", text: "You edited the architecture diagram.", at: now() }]);
      return { folder, ...g };
    });
    return send(res, 202, { jobId: job.id });
  }

  if (req.method === "GET" && p === "/vendor/mermaid.min.js") {
    const data = await fs.readFile(MERMAID_JS).catch(() => null);
    if (!data) throw httpError(404, "Mermaid isn't installed; run npm install.");
    res.writeHead(200, { "content-type": "text/javascript", "cache-control": "max-age=86400" });
    return res.end(data);
  }

  if (req.method === "POST" && p === "/api/import") {
    const cfg = await requireRepo();
    const { source, date } = await readJson(req);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, "Date must look like 2026-11-25.");
    const job = startJob("import", { folder: null, text: `Import ${String(source || "").trim()}` }, async ({ log, emit, job }) => {
      await pullIfRemote(cfg.repoPath, log);
      const imp = await importIntoRepo({ repoPath: cfg.repoPath, input: source, date, log });
      job.folder = imp.folder;
      emit({ kind: "tool", text: `Copied ${imp.fileCount} files into ${imp.folder}/` });
      const r = await describeImport({ repoPath: cfg.repoPath, folder: imp.folder, source: imp.source, date: imp.date, model: cfg.model, rules: activeRules(cfg), allowCommands: !!cfg.allowCommands, log, emit });
      const g = await commitAndPush(cfg.repoPath, [imp.folder], `Import idea: ${imp.folder}\n\nFrom ${imp.source}`, { push: cfg.push, log });
      await chats.append(imp.folder, [
        { role: "user", text: `Import ${imp.source}`, at: now() },
        { role: "assistant", text: r.reply, tools: toolsOf(job), at: now() },
      ], r.sessionId);
      return { folder: imp.folder, reply: r.reply, ...g };
    });
    return send(res, 202, { jobId: job.id });
  }

  if (req.method === "GET" && (m = p.match(/^\/api\/jobs\/([\w-]+)$/))) {
    const job = jobs.get(m[1]);
    if (!job) throw httpError(404, "No such job");
    return send(res, 200, job);
  }

  // Remove an idea: delete its folder, commit and push. A linked repo itself is never touched.
  if (req.method === "POST" && (m = p.match(/^\/api\/ideas\/([\w.-]+)\/remove$/))) {
    const cfg = await requireRepo();
    const folder = checkFolder(m[1]);
    const dir = path.join(cfg.repoPath, folder);
    if (path.resolve(dir) === path.resolve(here) || path.resolve(here).startsWith(path.resolve(dir) + path.sep)) {
      throw httpError(400, "That folder holds this app, so it can't be removed from here.");
    }
    if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) throw httpError(404, "That idea doesn't exist.");
    const job = startJob("remove", { folder, text: "" }, async ({ log }) => {
      await pullIfRemote(cfg.repoPath, log);
      const link = await readLink(cfg.repoPath, folder);
      await fs.rm(dir, { recursive: true, force: true });
      log(`Removed ${folder}/`);
      const g = await commitAndPush(cfg.repoPath, [folder], `Remove idea: ${folder}`, { push: cfg.push, log });
      await chats.remove(folder);
      if (link) log(`${parseRepoUrl(link.repo).label} itself wasn't changed.`);
      return { folder, ...g };
    });
    return send(res, 202, { jobId: job.id });
  }

  if (req.method === "POST" && (m = p.match(/^\/api\/ideas\/([\w.-]+)\/status$/))) {
    const cfg = await requireRepo();
    const { status } = await readJson(req);
    if (!STATUSES[status]) throw httpError(400, "status must be red, yellow or green");
    const folder = checkFolder(m[1]);
    const job = startJob("status", { folder }, async ({ log }) => {
      await pullIfRemote(cfg.repoPath, log);
      await updateIdeaStatus(cfg.repoPath, folder, status);
      log(`Set ${folder} to ${STATUSES[status].label}`);
      return commitAndPush(cfg.repoPath, [folder], `Status of ${folder}: ${STATUSES[status].emoji} ${STATUSES[status].label}`, { push: cfg.push, log });
    });
    return send(res, 202, { jobId: job.id });
  }

  throw httpError(404, "Not found");
}

// Read-only file server for the prototypes, on its own origin.
async function handlePreview(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") throw httpError(405, "Read-only");
  const cfg = await requireRepo();
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const m = p.match(/^\/([^/]+)\/(.*)$/);
  if (!m) throw httpError(404, "Not found");
  const folder = checkFolder(m[1]);
  const link = await readLink(cfg.repoPath, folder);
  const ideaDir = path.join(cfg.repoPath, folder);
  let rel = m[2];
  if (!rel || rel.endsWith("/")) rel += "index.html";
  if (!link) return serveFile(res, ideaDir, rel);
  if (rel.split(/[\\/]/)[0] === ".git") throw httpError(403, "Forbidden");
  // Linked ideas: files come from the clone, with the idea folder (the dummy-data demo) as a fallback.
  const clone = cloneDir(REPOS_DIR, parseRepoUrl(link.repo));
  const inClone = await fs.stat(path.resolve(clone, rel)).catch(() => null);
  return serveFile(res, inClone?.isFile() ? clone : ideaDir, rel);
}

const onError = (res) => (e) => {
  if (!e.status) console.error(e);
  if (!res.headersSent) send(res, e.status || 500, { error: e.message });
};
http.createServer((req, res) => handle(req, res).catch(onError(res))).listen(PORT, "127.0.0.1", () => console.log(`Idea Cooker running on http://localhost:${PORT}`));
http.createServer((req, res) => handlePreview(req, res).catch(onError(res))).listen(PREVIEW_PORT, "127.0.0.1", () => console.log(`Prototype previews on http://localhost:${PREVIEW_PORT}`));
