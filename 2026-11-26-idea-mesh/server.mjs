import http from "node:http";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { store, patchBrick, runOrder, skipReason, SETTING_OPTIONS } from "./lib/store.mjs";
import { loadCooker } from "./lib/bricks.mjs";
import { engine } from "./lib/engine.mjs";
import { cookerApi } from "./lib/cooker.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css",
  ".js": "text/javascript", ".mjs": "text/javascript", ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".woff2": "font/woff2",
};

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req, limit = 100_000) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw Object.assign(new Error("Request too large."), { status: 413 });
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error("Body must be JSON."), { status: 400 });
  }
}

/** Serve a file from `base`, refusing paths that climb out of it. */
async function serveFile(res, base, rel) {
  const file = path.resolve(base, "." + path.posix.normalize("/" + rel));
  if (!file.startsWith(path.resolve(base))) return send(res, 403, { error: "Forbidden" });
  const target = (await fs.stat(file).catch(() => null))?.isDirectory() ? path.join(file, "index.html") : file;
  const data = await fs.readFile(target).catch(() => null);
  if (!data) return send(res, 404, { error: "Not found" });
  send(res, 200, data, TYPES[path.extname(target)] || "application/octet-stream");
}

export async function startServer({
  port = Number(process.env.PORT || 4330),
  cookerDir = process.env.IDEA_COOKER_DIR || path.join(here, "..", "2026-11-25-idea-cooker"),
  dataDir = process.env.IDEA_MESH_DATA || here,
  repoPath = process.env.IDEA_MESH_REPO,
  chatsDir = process.env.IDEA_MESH_CHATS,
  quiet = false,
} = {}) {
  // Settings (repo, model, rule sets, push, commands) come from Idea Cooker's config, read fresh on each use.
  const cfgFile = process.env.IDEA_COOKER_CONFIG || path.join(cookerDir, "config.json");
  const readConfig = () => {
    try {
      return JSON.parse(readFileSync(cfgFile, "utf8"));
    } catch {
      return {};
    }
  };
  const cfg = readConfig();
  repoPath = path.resolve(repoPath || cfg.repoPath || path.join(here, ".."));
  const previewPort = port + 1;
  const log = (line) => quiet || console.log(`${new Date().toLocaleTimeString()} ${line}`);

  const clients = new Set();
  const env = {
    repoPath,
    config: readConfig,
    get model() {
      return readConfig().model || "";
    },
    get rules() {
      return this.activeRules(readConfig());
    },
    activeRules: (c) => (Array.isArray(c.rules) ? c.rules.filter((r) => r && r.enabled !== false && r.text) : []),
    lock: { by: null },
    previewPort,
    cooker: await loadCooker(cookerDir),
    store: store(dataDir),
    log,
    emit: (run) => {
      const msg = `data: ${JSON.stringify(publicRun(run))}\n\n`;
      for (const c of clients) c.write(msg);
    },
  };
  const eng = engine(env);
  const cooker = cookerApi(env, { engine: eng, chatsDir: chatsDir || path.join(cookerDir, "chats") });

  // A run that was in progress when the server stopped can't continue; mark it so the log is honest.
  const runs = await env.store.runs();
  let fixed = false;
  for (const r of runs) {
    if (r.state !== "running") continue;
    fixed = true;
    r.state = "failed";
    for (const s of r.steps) if (s.state === "running" || s.state === "waiting") Object.assign(s, { state: "failed", error: "The server stopped during this step." });
  }
  if (fixed) await env.store.saveRuns(runs);

  const origins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);

  async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (req.method !== "GET" && req.headers.origin && !origins.has(req.headers.origin)) return send(res, 403, { error: "Cross-origin request blocked." });

    if (p === "/api/state" && req.method === "GET") {
      const mesh = await env.store.mesh();
      const order = runOrder(mesh).map((b) => b.id);
      return send(res, 200, {
        repo: path.basename(repoPath),
        busy: eng.busy(),
        fake: process.env.IDEA_COOKER_FAKE === "1",
        options: SETTING_OPTIONS,
        mesh: { ...mesh, bricks: mesh.bricks.map((b) => ({ ...b, skip: order.includes(b.id) ? skipReason(b) : "Not in the run order" })) },
        runs: (await env.store.runs()).map(publicRun),
      });
    }
    const brickMatch = p.match(/^\/api\/bricks\/([a-z0-9-]+)$/);
    if (brickMatch && req.method === "PATCH") {
      if (eng.busy()) return send(res, 409, { error: "Wait for the run to finish before changing bricks." });
      const mesh = await env.store.mesh();
      const b = patchBrick(mesh, brickMatch[1], await readBody(req));
      await env.store.saveMesh(mesh);
      return send(res, 200, b);
    }
    if (p === "/api/run" && req.method === "POST") {
      const { prompt } = await readBody(req);
      if (!String(prompt || "").trim()) return send(res, 400, { error: "Write an idea first." });
      return send(res, 202, publicRun(await eng.start(String(prompt).trim().slice(0, 4000))));
    }
    if (p === "/api/stop" && req.method === "POST") return send(res, 200, { stopping: eng.stop() });
    const rerun = p.match(/^\/api\/runs\/([a-z0-9]+)\/rerun$/);
    if (rerun && req.method === "POST") {
      const { brick } = await readBody(req);
      return send(res, 202, publicRun(await eng.rerun(rerun[1], String(brick || ""))));
    }
    if (p === "/api/events" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (p === "/portfolio.json") return send(res, 200, await env.store.portfolio());
    const entry = p.match(/^\/api\/portfolio\/([a-z0-9-]+)$/);
    if (entry && req.method === "GET") {
      const item = (await env.store.portfolio()).items.find((i) => i.id === entry[1]);
      return item ? send(res, 200, item) : send(res, 404, { error: "This entry is no longer in portfolio.json." });
    }
    if (p.startsWith("/site/")) return serveFile(res, env.store.siteDir, decodeURIComponent(p.slice(6)));
    if (p.startsWith("/api/cooker/")) {
      if ((await cooker(req, res, p, url, { send, readBody })) !== false) return;
      return send(res, 404, { error: "Not found" });
    }
    // Idea Cooker's sketch editor and Mermaid, served from its folder so both apps use the same versions.
    if (p === "/vendor/sketch.js") return serveFile(res, path.join(cookerDir, "public"), "sketch.js");
    if (p === "/vendor/mermaid.min.js") return serveFile(res, path.join(cookerDir, "node_modules", "mermaid", "dist"), "mermaid.min.js");
    if (p === "/" || p === "/index.html") return serveFile(res, path.join(here, "public"), "index.html");
    if (p === "/cooker.js") return serveFile(res, path.join(here, "public"), "cooker.js");
    send(res, 404, { error: "Not found" });
  }

  const server = http.createServer((req, res) =>
    handle(req, res).catch((e) => {
      if (!e.status) log(`Error: ${e.stack || e.message}`);
      if (!res.headersSent) send(res, e.status || 500, { error: e.message });
    }),
  );
  // Prototypes are served read-only from their own port (a different origin), so their scripts can't call the API.
  const preview = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Read-only" });
    const m = decodeURIComponent(new URL(req.url, "http://x").pathname).match(/^\/(\d{4}-\d{2}-\d{2}-[\w.-]+)\/(.*)$/);
    if (!m) return send(res, 404, { error: "Not found" });
    serveFile(res, path.join(repoPath, m[1]), m[2] || "index.html").catch((e) => send(res, 500, { error: e.message }));
  });
  const listen = (srv, p) => new Promise((resolve, reject) => {
    srv.once("error", (e) => reject(e.code === "EADDRINUSE" ? new Error(`Port ${p} is already in use. Is IdeaMesh already running? Set PORT to use another port.`) : e));
    srv.listen(p, "127.0.0.1", resolve);
  });
  await listen(server, port);
  await listen(preview, previewPort).catch((e) => { server.close(); throw e; });
  log(`IdeaMesh running on http://localhost:${port} (repo: ${repoPath}, previews on ${previewPort})`);
  const close = () => Promise.all([
    new Promise((r) => { for (const c of clients) c.end(); server.close(r); }),
    new Promise((r) => preview.close(r)),
  ]);
  return { server, port, close };
}

/** The run as the page sees it: without the README text kept for reruns. */
function publicRun(r) {
  const { ctx, ...rest } = r;
  return rest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
