import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

/**
 * The Cooker page's API (/api/cooker/...). It works like Idea Cooker: design questions first, then cook or
 * change an idea with Claude, chat sessions that resume, and the UI sketch. It calls Idea Cooker's lib modules
 * and shares its chat history, so a conversation can move between the two apps.
 * One job at a time, shared with the mesh run engine (env.lock), so two things never write the repo at once.
 */
const FOLDER_RE = /^\d{4}-\d{2}-\d{2}-[\w.-]+$/;
const err = (status, message) => Object.assign(new Error(message), { status });
const now = () => new Date().toISOString();
const checkFolder = (f) => {
  if (!FOLDER_RE.test(String(f || ""))) throw err(400, "Bad idea folder.");
  return f;
};

function cleanDesign(answers, plan) {
  const list = Array.isArray(answers) ? answers.slice(0, 20) : [];
  return {
    answers: list
      .map((a) => ({ question: String(a?.question || "").slice(0, 500).trim(), answer: String(a?.answer || "").slice(0, 2000).trim() }))
      .filter((a) => a.question && a.answer),
    plan: typeof plan === "string" && plan.trim() ? plan.slice(0, 30_000) : "",
  };
}

export function cookerApi(env, { engine, chatsDir }) {
  const { generate, git, ideas, sketch: sketchLib } = env.cooker;
  const chats = env.cooker.chats.chatStore(chatsDir);
  const approvalsFile = path.join(env.store.dataDir, "approvals.json");
  const jobs = new Map();
  const repo = env.repoPath;
  const cfg = () => env.config(); // re-read so Settings changes in Idea Cooker apply here too

  // ---------- jobs ----------
  function startJob(kind, meta, fn) {
    if (env.lock.by || engine.busy()) throw err(409, engine.busy() ? "A mesh run is in progress. Wait for it to finish." : "Claude is still working on the last request.");
    const job = { id: randomUUID(), kind, ...meta, state: "running", events: [], startedAt: Date.now(), result: null, error: null };
    const log = (line) => env.log(`[cooker:${kind}] ${line}`);
    const emit = (ev) => job.events.push(ev);
    jobs.set(job.id, job);
    env.lock.by = job.id;
    fn({ log, emit, job })
      .then((r) => Object.assign(job, { state: "done", result: r }))
      .catch((e) => {
        log(`Error: ${e.message}`);
        Object.assign(job, { state: "error", error: e.message });
      })
      .finally(() => (env.lock.by = null));
    return job;
  }
  const toolsOf = (job) => job.events.filter((e) => e.kind === "tool").map((e) => e.text);

  // ---------- sketch approval: the first check layer ----------
  const hashOf = (text) => createHash("sha1").update(text).digest("hex");
  const readApprovals = () => fs.readFile(approvalsFile, "utf8").then(JSON.parse).catch(() => ({}));
  async function approval(folder) {
    const text = await fs.readFile(path.join(repo, folder, "SKETCH.json"), "utf8").catch(() => null);
    if (text === null) return { approved: false, reason: "No sketch yet" };
    const a = (await readApprovals())[folder];
    if (!a) return { approved: false, reason: "Not approved yet" };
    if (a.hash !== hashOf(text)) return { approved: false, reason: "The sketch changed after approval" };
    return { approved: true, at: a.at };
  }

  const ideaDir = async (folder) => {
    const dir = path.join(repo, checkFolder(folder));
    if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) throw err(404, "That idea doesn't exist.");
    if (await fs.stat(path.join(dir, "idea.json")).catch(() => null)) throw err(400, "This idea is linked to another repo. Change it in Idea Cooker for now.");
    return dir;
  };

  const entryOf = (files) => files.find((f) => f.toLowerCase() === "index.html") || files.find((f) => /\.html?$/i.test(f)) || null;

  // ---------- routes ----------
  return async function handle(req, res, p, url, { send, readBody }) {
    let m;
    if (p === "/api/cooker/ideas" && req.method === "GET") {
      const list = await ideas.listIdeas(repo);
      for (const i of list) {
        i.hasChat = await chats.has(i.folder);
        i.hasArch = i.files.includes("ARCHITECTURE.md");
        i.hasSketch = i.files.includes("SKETCH.json");
        i.linked = i.files.includes("idea.json");
        i.entry = entryOf(i.files);
        i.check = i.hasSketch ? await approval(i.folder) : { approved: false, reason: "No sketch yet" };
        i.site = !!(await fs.stat(path.join(env.store.siteDir, i.folder, "index.html")).catch(() => null));
      }
      return send(res, 200, { ideas: list, busy: env.lock.by, previewPort: env.previewPort, push: !!cfg().push });
    }

    if ((m = p.match(/^\/api\/cooker\/chat\/([\w.-]+)$/)) && req.method === "GET") {
      return send(res, 200, { messages: (await chats.get(checkFolder(m[1]))).messages });
    }

    if ((m = p.match(/^\/api\/cooker\/file\/([\w.-]+)$/)) && req.method === "GET") {
      const which = url.searchParams.get("which") === "arch" ? "ARCHITECTURE.md" : "README.md";
      const text = await fs.readFile(path.join(repo, checkFolder(m[1]), which), "utf8").catch(() => null);
      return text === null ? send(res, 404, { error: `No ${which} yet.` }) : send(res, 200, { text });
    }

    if ((m = p.match(/^\/api\/cooker\/jobs\/([\w-]+)$/)) && req.method === "GET") {
      const job = jobs.get(m[1]);
      return job ? send(res, 200, job) : send(res, 404, { error: "Unknown job." });
    }

    // Design questions before building. Read-only.
    if (p === "/api/cooker/questions" && req.method === "POST") {
      const { folder, message } = await readBody(req);
      const text = String(message || "").trim();
      if (!text) throw err(400, "Write a message first.");
      if (folder) await ideaDir(folder);
      const c = cfg();
      const job = startJob("questions", { folder: folder || null, text }, ({ log }) =>
        generate.askQuestions({ repoPath: repo, folder: folder || null, message: text, model: c.model, rules: env.activeRules(c), log }),
      );
      return send(res, 202, { jobId: job.id });
    }

    // The chat box: no folder cooks a new idea, a folder changes it, mode "review" asks for sketch feedback.
    if (p === "/api/cooker/chat" && req.method === "POST") {
      const { folder, message, saveOnly, answers, plan, mode } = await readBody(req);
      const text = String(message || "").trim();
      if (!text) throw err(400, "Write a message first.");
      const c = cfg();
      const design = cleanDesign(answers, plan);
      const userMsg = () => ({ role: "user", text, at: now(), ...(design.answers.length ? { answers: design.answers } : {}), ...(design.plan ? { plan: true } : {}) });
      const common = { model: c.model, rules: env.activeRules(c), allowCommands: !!c.allowCommands };

      if (!folder) {
        const job = startJob("cook", { folder: null, text, saveOnly: !!saveOnly }, async ({ log, emit, job }) => {
          await git.pullIfRemote(repo, log);
          const r = await generate.cookIdea({ repoPath: repo, idea: text, design, saveOnly: !!saveOnly, log, emit, ...common });
          job.folder = r.folder;
          const g = await git.commitAndPush(repo, [r.folder], `${saveOnly ? "Saved idea" : "Daily idea"}: ${r.folder}\n\n${text.split("\n")[0].slice(0, 72)}`, { push: !!c.push, log });
          await chats.append(r.folder, [userMsg(), { role: "assistant", text: r.reply, tools: toolsOf(job), at: now() }], r.sessionId);
          return { folder: r.folder, reply: r.reply, ...g };
        });
        return send(res, 202, { jobId: job.id });
      }

      await ideaDir(folder);
      if (mode === "review") {
        const job = startJob("review", { folder, text }, async ({ log, emit, job }) => {
          const chat = await chats.get(folder);
          const r = await generate.reviewSketch({ repoPath: repo, folder, message: text, sessionId: chat.sessionId, model: c.model, rules: env.activeRules(c), log, emit });
          await chats.append(folder, [userMsg(), { role: "assistant", text: r.reply, tools: toolsOf(job), at: now() }], r.sessionId);
          return { folder, reply: r.reply };
        });
        return send(res, 202, { jobId: job.id });
      }

      const job = startJob("revise", { folder, text }, async ({ log, emit, job }) => {
        try {
          await git.pullIfRemote(repo, log);
          const chat = await chats.get(folder);
          const r = await generate.reviseIdea({ repoPath: repo, folder, message: text, design, sessionId: chat.sessionId, log, emit, ...common });
          const g = await git.commitAndPush(repo, [folder], `Update ${folder}\n\n${text.split("\n")[0].slice(0, 72)}`, { push: !!c.push, log });
          await chats.append(folder, [userMsg(), { role: "assistant", text: r.reply, tools: toolsOf(job), at: now() }], r.sessionId);
          return { folder, reply: r.reply, ...g };
        } catch (e) {
          await chats.append(folder, [userMsg(), { role: "assistant", text: e.message, error: true, tools: toolsOf(job), at: now() }]);
          throw e;
        }
      });
      return send(res, 202, { jobId: job.id });
    }

    if ((m = p.match(/^\/api\/cooker\/sketch\/([\w.-]+)\/draft$/)) && req.method === "POST") {
      const folder = m[1];
      const dir = await ideaDir(folder);
      const { instructions } = await readBody(req);
      const text = String(instructions || "").trim().slice(0, 4000);
      const asked = text || "Draft a first UI sketch for this idea.";
      const c = cfg();
      const job = startJob("draft", { folder, text: asked }, async ({ log }) => {
        const chat = await chats.get(folder);
        const hasSketch = !!(await fs.stat(path.join(dir, "SKETCH.json")).catch(() => null));
        const r = await generate.draftSketch({ repoPath: repo, folder, instructions: text, hasSketch, sessionId: chat.sessionId, model: c.model, rules: env.activeRules(c), log });
        const sketch = sketchLib.cleanSketch(r.sketch);
        if (!sketch.shapes.length) throw new Error("Claude's draft was empty. Try again.");
        await chats.append(folder, [
          { role: "user", text: asked, at: now() },
          { role: "assistant", text: `${r.note || "Here's a first draft of the UI."}\n\nIt's in the Sketch tab, not saved yet: change what you like, then Save.`, at: now() },
        ], r.sessionId);
        return { folder, sketch, note: r.note };
      });
      return send(res, 202, { jobId: job.id });
    }

    if ((m = p.match(/^\/api\/cooker\/sketch\/([\w.-]+)\/approve$/)) && req.method === "POST") {
      const folder = m[1];
      const dir = await ideaDir(folder);
      const { approved } = await readBody(req);
      const list = await readApprovals();
      if (approved === false) delete list[folder];
      else {
        const text = await fs.readFile(path.join(dir, "SKETCH.json"), "utf8").catch(() => null);
        if (text === null) throw err(400, "Save a sketch before approving it.");
        list[folder] = { hash: hashOf(text), at: now() };
      }
      await fs.writeFile(approvalsFile, JSON.stringify(list, null, 2) + "\n");
      if (approved !== false) await chats.append(folder, [{ role: "note", text: "You approved the UI sketch.", at: now() }]);
      return send(res, 200, await approval(folder));
    }

    if ((m = p.match(/^\/api\/cooker\/sketch\/([\w.-]+)$/))) {
      const folder = m[1];
      const dir = await ideaDir(folder);
      if (req.method === "GET") {
        const text = await fs.readFile(path.join(dir, "SKETCH.json"), "utf8").catch(() => null);
        return text === null ? send(res, 404, { error: "No sketch yet." }) : send(res, 200, { sketch: JSON.parse(text) });
      }
      if (req.method === "POST") {
        const body = await readBody(req, 4_000_000);
        const sketch = sketchLib.cleanSketch(body.sketch);
        if (!sketch.shapes.length) throw err(400, "The sketch is empty.");
        const png = sketchLib.sketchPngBuffer(body.png);
        const c = cfg();
        const job = startJob("sketch", { folder, text: "" }, async ({ log }) => {
          await git.pullIfRemote(repo, log);
          await fs.writeFile(path.join(dir, "SKETCH.json"), JSON.stringify(sketch, null, 2) + "\n", "utf8");
          if (png) await fs.writeFile(path.join(dir, "SKETCH.png"), png);
          const g = await git.commitAndPush(repo, [folder], `Update UI sketch: ${folder}`, { push: !!c.push, log });
          if (g.committed) await chats.append(folder, [{ role: "note", text: `You updated the UI sketch (${sketch.shapes.length} figures).`, at: now() }]);
          return { folder, ...g };
        });
        return send(res, 202, { jobId: job.id });
      }
    }

    // Send a cooked idea through the mesh. The sketch has to be approved first.
    if ((m = p.match(/^\/api\/cooker\/mesh\/([\w.-]+)$/)) && req.method === "POST") {
      const folder = m[1];
      await ideaDir(folder);
      const a = await approval(folder);
      if (!a.approved) throw err(400, `Approve the sketch first (${a.reason.toLowerCase()}).`);
      const readme = await fs.readFile(path.join(repo, folder, "README.md"), "utf8");
      const title = (readme.match(/^#\s+(.+)$/m)?.[1] || folder).trim();
      const { ctx, ...run } = await engine.start(title, { folder });
      return send(res, 202, run);
    }

    return false;
  };
}
