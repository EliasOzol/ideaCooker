import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { inspectRepo, pullIfRemote, commitAndPush } from "./lib/git.mjs";
import { listIdeas, updateIdeaStatus, STATUSES } from "./lib/ideas.mjs";
import { generateIdea } from "./lib/generate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4321);
const CONFIG_FILE = process.env.IDEA_COOKER_CONFIG || path.join(here, "config.json");
const PUBLIC_DIR = path.join(here, "public");

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
  if (!cfg.repoPath || !cfg.confirmed) throw httpError(409, "Set and confirm your daily-ideas repo path first.");
  return cfg;
}

// ---------- jobs (one at a time, so two runs never race on the same repo) ----------
const jobs = new Map();
let busy = null;

function startJob(kind, fn) {
  if (busy) throw httpError(409, "Another job is still running.");
  const job = { id: randomUUID(), kind, state: "running", log: [], startedAt: Date.now(), result: null, error: null };
  const log = (line) => {
    job.log.push(`${new Date().toLocaleTimeString()}  ${line}`);
    console.log(`[${kind}] ${line}`);
  };
  jobs.set(job.id, job);
  busy = job.id;
  fn(log)
    .then((r) => Object.assign(job, { state: "done", result: r }))
    .catch((e) => {
      log(`❌ ${e.message}`);
      Object.assign(job, { state: "error", error: e.message });
    })
    .finally(() => (busy = null));
  return job;
}

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
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".md": "text/plain; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".py": "text/plain; charset=utf-8", ".ino": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8" };
async function serveFile(res, baseDir, rel) {
  const abs = path.resolve(baseDir, rel);
  if (abs !== baseDir && !abs.startsWith(baseDir + path.sep)) throw httpError(403, "Forbidden");
  const data = await fs.readFile(abs).catch(() => null);
  if (!data) throw httpError(404, "Not found");
  res.writeHead(200, { "content-type": MIME[path.extname(abs).toLowerCase()] || "application/octet-stream" });
  res.end(data);
}

// ---------- routes ----------
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = decodeURIComponent(url.pathname);

  // Same-origin guard for state-changing calls (the server only listens on localhost, this blocks cross-site POSTs too).
  if (req.method !== "GET") {
    const origin = req.headers.origin;
    if (origin && origin !== `http://localhost:${PORT}` && origin !== `http://127.0.0.1:${PORT}`) throw httpError(403, "Cross-origin request blocked");
  }

  if (req.method === "GET" && (p === "/" || p === "/index.html")) return serveFile(res, PUBLIC_DIR, "index.html");

  if (req.method === "GET" && p === "/api/config") {
    const cfg = await loadConfig();
    const repo = cfg.repoPath ? await inspectRepo(cfg.repoPath).catch((e) => ({ ok: false, error: e.message })) : null;
    return send(res, 200, { ...cfg, repo, statuses: STATUSES, busy });
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
    return send(res, 200, await listIdeas(cfg.repoPath));
  }

  if (req.method === "POST" && p === "/api/ideas") {
    const cfg = await requireRepo();
    const { idea } = await readJson(req);
    if (!idea || !idea.trim()) throw httpError(400, "Write an idea first.");
    const job = startJob("new-idea", async (log) => {
      await pullIfRemote(cfg.repoPath, log);
      const folder = await generateIdea({ repoPath: cfg.repoPath, idea: idea.trim(), model: cfg.model, log });
      log(`📁 Created ${folder}/`);
      const title = idea.trim().split("\n")[0].slice(0, 60);
      const git = await commitAndPush(cfg.repoPath, [folder], `Daily idea: ${folder}\n\n${title}`, { push: cfg.push, log });
      return { folder, ...git };
    });
    return send(res, 202, { jobId: job.id });
  }

  let m;
  if (req.method === "GET" && (m = p.match(/^\/api\/jobs\/([\w-]+)$/))) {
    const job = jobs.get(m[1]);
    if (!job) throw httpError(404, "No such job");
    return send(res, 200, job);
  }

  if (req.method === "POST" && (m = p.match(/^\/api\/ideas\/([\w.-]+)\/status$/))) {
    const cfg = await requireRepo();
    const { status } = await readJson(req);
    if (!STATUSES[status]) throw httpError(400, "status must be red, yellow or green");
    const folder = m[1];
    const job = startJob("status", async (log) => {
      await pullIfRemote(cfg.repoPath, log);
      await updateIdeaStatus(cfg.repoPath, folder, status);
      log(`${STATUSES[status].emoji} ${folder}`);
      return commitAndPush(cfg.repoPath, [folder], `Status of ${folder}: ${STATUSES[status].emoji} ${STATUSES[status].label}`, { push: cfg.push, log });
    });
    return send(res, 202, { jobId: job.id });
  }

  // Open an idea's files (README, prototype) from the list.
  if (req.method === "GET" && (m = p.match(/^\/ideas\/([\w.-]+)\/(.*)$/))) {
    const cfg = await requireRepo();
    const base = path.resolve(cfg.repoPath, m[1]);
    return serveFile(res, base, m[2] || "README.md");
  }

  throw httpError(404, "Not found");
}

http
  .createServer((req, res) =>
    handle(req, res).catch((e) => {
      if (!e.status) console.error(e);
      if (!res.headersSent) send(res, e.status || 500, { error: e.message });
    }),
  )
  .listen(PORT, "127.0.0.1", () => console.log(`🍳 Idea Cooker on http://localhost:${PORT}`));
