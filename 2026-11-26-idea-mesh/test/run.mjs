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
const app = await startServer({ port: 4339, dataDir: data, repoPath: repo, chatsDir: path.join(tmp, "chats"), quiet: true });
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
    const entry = await call(`/api/portfolio/${run.folder}`);
    assert.equal(entry.status, 200);
    assert.equal(entry.body.id, run.folder);
    assert.equal((await call("/api/portfolio/no-such-idea")).status, 404);
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
  const waitJob = async (start) => {
    const r = await start;
    assert.equal(r.status, 202, JSON.stringify(r.body));
    for (let i = 0; i < 200; i++) {
      const j = (await call(`/api/cooker/jobs/${r.body.jobId}`)).body;
      if (j.state !== "running") return j;
      await new Promise((ok) => setTimeout(ok, 25));
    }
    throw new Error("Job didn't finish");
  };
  const post = (p, body) => call(p, { method: "POST", body: JSON.stringify(body) });

  await test("run log has no web page link", async () => {
    assert.equal(run.steps.find((s) => s.brick === "website").link ?? null, null);
  });

  await test("Cooker page assets load", async () => {
    assert.equal((await fetch(base + "/cooker.js")).status, 200);
    assert.equal((await fetch(base + "/vendor/sketch.js")).status, 200);
    const ideas = (await call("/api/cooker/ideas")).body;
    assert.ok(ideas.ideas.some((i) => i.folder === run.folder));
    assert.equal(ideas.previewPort, 4340);
  });

  let cooked;
  await test("Cooker: questions, then cook a new idea with a prototype", async () => {
    const q = await waitJob(post("/api/cooker/questions", { message: "A tiny habit tracker" }));
    assert.equal(q.state, "done");
    assert.equal(q.result.questions.length, 2);
    const j = await waitJob(post("/api/cooker/chat", { message: "A tiny habit tracker", answers: [{ question: "Who is it for?", answer: "Just me" }] }));
    assert.equal(j.state, "done", j.error);
    cooked = j.result.folder;
    assert.equal(j.result.committed, true);
    assert.equal(j.result.pushed, false);
    const chat = (await call(`/api/cooker/chat/${cooked}`)).body.messages;
    assert.equal(chat[0].answers[0].answer, "Just me");
    const page = await fetch(`http://127.0.0.1:4340/${cooked}/index.html`);
    assert.equal(page.status, 200);
  });

  await test("Cooker: a follow-up resumes the idea's chat", async () => {
    const j = await waitJob(post("/api/cooker/chat", { folder: cooked, message: "Make the buttons bigger" }));
    assert.equal(j.state, "done", j.error);
    assert.equal((await call(`/api/cooker/chat/${cooked}`)).body.messages.length, 4);
  });

  await test("Cooker: mesh is blocked until the sketch is approved", async () => {
    assert.equal((await post(`/api/cooker/mesh/${cooked}`, {})).status, 400);
    const d = await waitJob(post(`/api/cooker/sketch/${cooked}/draft`, {}));
    assert.equal(d.state, "done", d.error);
    const s = await waitJob(post(`/api/cooker/sketch/${cooked}`, { sketch: d.result.sketch }));
    assert.equal(s.state, "done", s.error);
    const a = await post(`/api/cooker/sketch/${cooked}/approve`, { approved: true });
    assert.equal(a.body.approved, true);
  });

  await test("Cooker: an approved idea runs through the mesh without cooking again", async () => {
    const r = await post(`/api/cooker/mesh/${cooked}`, {});
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(r.body.ctx, undefined);
    const s = await waitIdle();
    const last = s.runs[0];
    assert.equal(last.folder, cooked);
    assert.deepEqual(last.steps.map((x) => x.state), ["ok", "ok", "ok"]);
    assert.match(last.steps[0].detail, /Used the cooked idea/);
    const ideas = (await call("/api/cooker/ideas")).body.ideas;
    assert.equal(ideas.find((i) => i.folder === cooked).site, true);
  });

  await test("Cooker: changing the sketch resets the approval", async () => {
    const sk = (await call(`/api/cooker/sketch/${cooked}`)).body.sketch;
    sk.shapes[0].label = "Changed";
    await waitJob(post(`/api/cooker/sketch/${cooked}`, { sketch: sk }));
    const i = (await call("/api/cooker/ideas")).body.ideas.find((x) => x.folder === cooked);
    assert.equal(i.check.approved, false);
    assert.match(i.check.reason, /changed/);
  });
} finally {
  await app.close();
  await fs.rm(tmp, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} failed` : "\nAll passed");
process.exit(failed ? 1 : 0);
