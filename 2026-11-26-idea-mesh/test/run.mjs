// End-to-end test: a full mesh run against a throwaway git repo in test/.tmp, with Idea Cooker's
// fake mode, so no Claude call is made. Run: npm test
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(here, ".tmp");
const repo = path.join(tmp, "repo");
const data = path.join(tmp, "data");

await fs.rm(tmp, { recursive: true, force: true });
await fs.mkdir(repo, { recursive: true });
await fs.mkdir(data, { recursive: true });
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
git("init", "-q");
git("config", "user.email", "test@example.com");
git("config", "user.name", "IdeaMesh test");
await fs.writeFile(path.join(repo, "README.md"), "# Test ideas\n");
git("add", "README.md");
git("commit", "-qm", "init");

process.env.IDEA_COOKER_FAKE = "1";
process.env.IDEA_COOKER_CONFIG = path.join(tmp, "no-config.json");
const { startServer } = await import("../server.mjs");
const app = await startServer({ port: 4339, dataDir: data, repoPath: repo, quiet: true });
const base = `http://127.0.0.1:${app.port}`;
const call = async (p, opts = {}) => {
  const r = await fetch(base + p, { ...opts, headers: { "content-type": "application/json" } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const waitIdle = async () => {
  for (let i = 0; i < 100; i++) {
    const s = (await call("/api/state")).body;
    if (!s.busy) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Run didn't finish");
};

let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.message}`);
  }
};

try {
  await test("page and state load", async () => {
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Brick network/);
    const s = (await call("/api/state")).body;
    assert.deepEqual(s.mesh.bricks.map((b) => b.id), ["passrotor", "repo", "portfolio", "website", "recap"]);
    assert.equal(s.mesh.bricks.find((b) => b.id === "recap").skip, "Not in the run order");
  });

  await test("empty prompt is rejected", async () => {
    assert.equal((await call("/api/run", { method: "POST", body: "{}" })).status, 400);
  });

  await test("settings only accept known values", async () => {
    assert.equal((await call("/api/bricks/portfolio", { method: "PATCH", body: JSON.stringify({ settings: { tone: "loud" } }) })).status, 400);
    assert.equal((await call("/api/bricks/passrotor", { method: "PATCH", body: JSON.stringify({ enabled: true }) })).status, 400);
    assert.equal((await call("/api/bricks/recap", { method: "PATCH", body: JSON.stringify({ enabled: true }) })).status, 400);
    const r = await call("/api/bricks/portfolio", { method: "PATCH", body: JSON.stringify({ settings: { tone: "technical" } }) });
    assert.equal(r.body.settings.tone, "technical");
  });

  await test("cross-origin writes are blocked", async () => {
    const r = await fetch(base + "/api/run", { method: "POST", headers: { origin: "http://evil.test", "content-type": "application/json" }, body: JSON.stringify({ prompt: "x" }) });
    assert.equal(r.status, 403);
  });

  let run;
  await test("a run writes, commits, adds to the portfolio and the local site", async () => {
    const start = await call("/api/run", { method: "POST", body: JSON.stringify({ prompt: "A plant that tweets when it is thirsty" }) });
    assert.equal(start.status, 202);
    const s = await waitIdle();
    run = s.runs[0];
    assert.equal(run.state, "ok", JSON.stringify(run.steps));
    assert.deepEqual(run.steps.map((x) => x.state), ["ok", "ok", "ok"]);
    assert.match(run.folder, /^\d{4}-\d{2}-\d{2}-a-plant-that$/);
    assert.match(git("log", "-1", "--pretty=%s"), new RegExp(`IdeaMesh: ${run.folder}`));
    assert.equal(git("status", "--porcelain"), "");
    const pf = JSON.parse(await fs.readFile(path.join(data, "portfolio.json"), "utf8"));
    assert.equal(pf.items[0].id, run.folder);
    assert.equal(pf.items[0].kind, "hobby");
    const page = await fetch(`${base}/site/${run.folder}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /A plant that tweets/);
    assert.equal((await fetch(`${base}/site/../server.mjs`)).status, 404);
  });

  await test("a switched-off brick is skipped", async () => {
    await call("/api/bricks/website", { method: "PATCH", body: JSON.stringify({ enabled: false }) });
    await call("/api/run", { method: "POST", body: JSON.stringify({ prompt: "Second idea" }) });
    const s = await waitIdle();
    assert.deepEqual(s.runs[0].steps.map((x) => x.state), ["ok", "ok", "skipped"]);
    await call("/api/bricks/website", { method: "PATCH", body: JSON.stringify({ enabled: true }) });
  });

  await test("a failing brick stops the chain and can be rerun", async () => {
    await fs.writeFile(path.join(data, "portfolio.json"), "not json");
    await call("/api/run", { method: "POST", body: JSON.stringify({ prompt: "Third idea" }) });
    let s = await waitIdle();
    const r = s.runs[0];
    assert.deepEqual(r.steps.map((x) => x.state), ["ok", "failed", "skipped"]);
    assert.match(r.steps[1].error, /not valid JSON/);
    assert.equal((await call(`/api/runs/${r.id}/rerun`, { method: "POST", body: JSON.stringify({ brick: "repo" }) })).status, 400);
    await fs.rm(path.join(data, "portfolio.json"));
    assert.equal((await call(`/api/runs/${r.id}/rerun`, { method: "POST", body: JSON.stringify({ brick: "portfolio" }) })).status, 202);
    s = await waitIdle();
    assert.equal(s.runs[0].steps[1].state, "ok");
  });
} finally {
  await app.close();
  await fs.rm(tmp, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} failed` : "\nAll passed");
process.exit(failed ? 1 : 0);
