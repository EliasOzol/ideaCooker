// End-to-end test against a throwaway repo + bare "GitHub" remote in the OS temp dir.
//   npm test                -> fake generator (no Claude call), tests git + API + status
//   npm test -- --real      -> really calls Claude via the Agent SDK (needs a Claude Code login)
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { git } from "../lib/git.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const real = process.argv.includes("--real");
const PORT = 4400 + Math.floor(Math.random() * 500);
const base = `http://localhost:${PORT}`;
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-cooker-e2e-"));
const remote = path.join(tmp, "remote.git");
const clone = path.join(tmp, "daily-ideas");
const ok = (cond, msg) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
};
const must = async (cwd, args) => {
  const r = await git(cwd, args);
  if (r.code) throw new Error(r.stderr);
  return r.stdout;
};

console.log(`temp dir: ${tmp}${real ? " (REAL Claude call)" : " (fake generator)"}`);
await must(tmp, ["init", "--bare", "-b", "main", remote]);
await must(tmp, ["clone", remote, clone]);
await must(clone, ["config", "user.email", "test@example.com"]);
await must(clone, ["config", "user.name", "e2e"]);
await fs.mkdir(path.join(clone, "2026-11-25-brain-reminder"));
await fs.copyFile(path.join(here, "..", "example", "README.md"), path.join(clone, "2026-11-25-brain-reminder", "README.md"));
await must(clone, ["add", "."]);
await must(clone, ["commit", "-m", "seed"]);
await must(clone, ["push", "-u", "origin", "main"]);

const server = spawn(process.execPath, [path.join(here, "..", "server.mjs")], {
  env: { ...process.env, PORT: String(PORT), IDEA_COOKER_CONFIG: path.join(tmp, "config.json"), IDEA_COOKER_FAKE: real ? "" : "1" },
  stdio: ["ignore", "pipe", "inherit"],
});
server.stdout.on("data", (d) => process.stdout.write(`    | ${d}`));
await new Promise((r) => server.stdout.once("data", r));

const api = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${url}: ${j.error}`);
  return j;
};
const waitJob = async (id) => {
  for (;;) {
    const j = await api("GET", `/api/jobs/${id}`);
    if (j.state !== "running") return j;
    await new Promise((r) => setTimeout(r, 1000));
  }
};

try {
  const r0 = await fetch(`${base}/api/ideas`, { method: "POST", body: JSON.stringify({ idea: "x" }) });
  ok(r0.status === 409, "refuses to cook before a repo is confirmed");

  const check = await api("POST", "/api/repo/check", { repoPath: clone });
  ok(check.ok && check.ideas === 1 && check.remote, "repo check sees the clone, its remote and 1 idea");
  await api("POST", "/api/config", { repoPath: clone, push: true });

  let ideas = await api("GET", "/api/ideas");
  ok(ideas[0].status === "yellow" && ideas[0].title.includes("BrainReminder"), "lists the seeded idea as 🟡");

  const idea = "A plant pot that tweets passive-aggressive messages when you forget to water it";
  const { jobId } = await api("POST", "/api/ideas", { idea });
  const job = await waitJob(jobId);
  console.log(job.log.map((l) => `    ${l}`).join("\n"));
  ok(job.state === "done", `new-idea job finished (${job.error || job.result.folder})`);
  ok(job.result.pushed, "commit was pushed");
  const folder = job.result.folder;
  ok(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(folder), `folder name ${folder} is <date>-<slug>`);
  const remoteLog = await must(remote, ["log", "--name-only", "--format=%s", "-1", "main"]);
  ok(remoteLog.includes(`${folder}/README.md`), "README.md is in the remote's latest commit");

  ideas = await api("GET", "/api/ideas");
  const mine = ideas.find((i) => i.folder === folder);
  ok(mine && mine.status, `new idea is listed with status ${mine?.status}`);

  const s = await waitJob((await api("POST", `/api/ideas/${folder}/status`, { status: "green" })).jobId);
  ok(s.state === "done" && s.result.pushed, "status change committed and pushed");
  ideas = await api("GET", "/api/ideas");
  ok(ideas.find((i) => i.folder === folder).status === "green", "idea now shows 🟢");
  const readme = await must(remote, ["show", `main:${folder}/README.md`]);
  ok(/## Status\s+🟢 \*\*Done\.\*\*/u.test(readme), "remote README has the 🟢 **Done.** line");

  const proto = await fetch(`${base}/ideas/${folder}/README.md`);
  ok(proto.ok, "idea files are served at /ideas/<folder>/");
  const trav = await fetch(`${base}/ideas/${folder}/..%2F..%2Fconfig.json`);
  ok(trav.status === 403 || trav.status === 404, "path traversal is blocked");
  console.log(`\nALL PASSED. Repo left at ${clone}`);
} finally {
  server.kill();
}
