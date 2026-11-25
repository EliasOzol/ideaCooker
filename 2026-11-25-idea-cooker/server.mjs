import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { inspectRepo, pullIfRemote, commitAndPush } from "./lib/git.mjs";
import { listIdeas, updateIdeaStatus, STATUSES } from "./lib/ideas.mjs";
import { cookIdea, reviseIdea, describeImport } from "./lib/generate.mjs";
import { importIntoRepo } from "./lib/importer.mjs";
import { chatStore } from "./lib/chats.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4321);
// Prototypes are served from a second port (a different origin), so their scripts can't call this app's API.
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT || PORT + 1);
const CONFIG_FILE = process.env.IDEA_COOKER_CONFIG || path.join(here, "config.json");
const chats = chatStore(process.env.IDEA_COOKER_CHATS || path.join(here, "chats"));
const PUBLIC_DIR = path.join(here, "public");
const FOLDER_RE = /^\d{4}-\d{2}-\d{2}-[\w.-]+$/;

// ---------- config ----------
async function loadConfig() {
  try {
    return { push: true, model: "", ...JSON.parse(await fs.readFile(CONFIG_FILE, "utf8")) };
  } catch {
    return { repoPath: "", confirmed: false, push: true, model: "" };
  }
}
async function saveConfig(cfg) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n", "utf8");
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
    await saveConfig(cfg);
    return send(res, 200, cfg);
  }

  if (req.method === "GET" && p === "/api/ideas") {
    const cfg = await loadConfig();
    if (!cfg.repoPath || !cfg.confirmed) return send(res, 200, []);
    const ideas = await listIdeas(cfg.repoPath);
    for (const i of ideas) {
      i.entry = entryOf(i.files);
      i.hasChat = await chats.has(i.folder);
    }
    return send(res, 200, ideas);
  }

  let m;
  if (req.method === "GET" && (m = p.match(/^\/api\/ideas\/([\w.-]+)\/readme$/))) {
    const cfg = await requireRepo();
    const text = await fs.readFile(path.join(cfg.repoPath, checkFolder(m[1]), "README.md"), "utf8").catch(() => null);
    if (text === null) throw httpError(404, "No README");
    return send(res, 200, { text });
  }

  if (req.method === "GET" && (m = p.match(/^\/api\/chat\/([\w.-]+)$/))) {
    const chat = await chats.get(checkFolder(m[1]));
    return send(res, 200, { messages: chat.messages });
  }

  // One endpoint for the chat box: no folder = cook a new idea, a folder = change that idea.
  if (req.method === "POST" && p === "/api/chat") {
    const cfg = await requireRepo();
    const { folder, message } = await readJson(req);
    const text = String(message || "").trim();
    if (!text) throw httpError(400, "Write a message first.");

    if (!folder) {
      const job = startJob("cook", { folder: null, text }, async ({ log, emit, job }) => {
        await pullIfRemote(cfg.repoPath, log);
        const r = await cookIdea({ repoPath: cfg.repoPath, idea: text, model: cfg.model, log, emit });
        job.folder = r.folder;
        log(`Created ${r.folder}/`);
        const g = await commitAndPush(cfg.repoPath, [r.folder], `Daily idea: ${r.folder}\n\n${text.split("\n")[0].slice(0, 72)}`, { push: cfg.push, log });
        await chats.append(r.folder, [
          { role: "user", text, at: now() },
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
        const r = await reviseIdea({ repoPath: cfg.repoPath, folder, message: text, sessionId: chat.sessionId, model: cfg.model, log, emit });
        const g = await commitAndPush(cfg.repoPath, [folder], `Update ${folder}\n\n${text.split("\n")[0].slice(0, 72)}`, { push: cfg.push, log });
        await chats.append(folder, [
          { role: "user", text, at: now() },
          { role: "assistant", text: r.reply, tools: toolsOf(job), at: now() },
        ], r.sessionId);
        return { folder, reply: r.reply, ...g };
      } catch (e) {
        await chats.append(folder, [
          { role: "user", text, at: now() },
          { role: "assistant", text: e.message, error: true, tools: toolsOf(job), at: now() },
        ]);
        throw e;
      }
    });
    return send(res, 202, { jobId: job.id });
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
      const r = await describeImport({ repoPath: cfg.repoPath, folder: imp.folder, source: imp.source, date: imp.date, model: cfg.model, log, emit });
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
  const base = path.join(cfg.repoPath, checkFolder(m[1]));
  let rel = m[2];
  if (!rel || rel.endsWith("/")) rel += "index.html";
  return serveFile(res, base, rel);
}

const onError = (res) => (e) => {
  if (!e.status) console.error(e);
  if (!res.headersSent) send(res, e.status || 500, { error: e.message });
};
http.createServer((req, res) => handle(req, res).catch(onError(res))).listen(PORT, "127.0.0.1", () => console.log(`Idea Cooker running on http://localhost:${PORT}`));
http.createServer((req, res) => handlePreview(req, res).catch(onError(res))).listen(PREVIEW_PORT, "127.0.0.1", () => console.log(`Prototype previews on http://localhost:${PREVIEW_PORT}`));
