import { BRICKS } from "./bricks.mjs";
import { runOrder, skipReason } from "./store.mjs";

/**
 * Runs the prompt through the bricks one at a time. One run at a time; `emit(run)` is called
 * after every step so the page can follow along. Stopping lets the current brick finish.
 */
export function engine(env) {
  let current = null;

  async function save(run) {
    const runs = await env.store.runs();
    const i = runs.findIndex((r) => r.id === run.id);
    if (i >= 0) runs[i] = run;
    else runs.unshift(run);
    await env.store.saveRuns(runs);
    env.emit(run);
  }

  async function step(run, s, brick) {
    s.state = "running";
    s.startedAt = new Date().toISOString();
    await save(run);
    const log = (line) => env.log(`[${brick.id}] ${line}`);
    try {
      const out = await BRICKS[brick.id]({ ctx: run.ctx, brick, env, log });
      Object.assign(s, { state: "ok", detail: out.detail, link: out.link || null, error: null });
    } catch (e) {
      Object.assign(s, { state: "failed", error: e.message, detail: null });
      log(`failed: ${e.message}`);
    }
    s.endedAt = new Date().toISOString();
    if (run.ctx.folder) run.folder = run.ctx.folder;
    await save(run);
    return s.state === "ok";
  }

  async function execute(run, mesh) {
    let blocked = null;
    for (const s of run.steps) {
      if (s.state === "skipped") continue;
      if (current?.stop) blocked = "Stopped";
      if (blocked) {
        Object.assign(s, { state: "skipped", detail: blocked });
        continue;
      }
      const brick = mesh.bricks.find((b) => b.id === s.brick);
      if (!(await step(run, s, brick))) blocked = `${brick.label} failed`;
    }
    run.state = run.steps.some((s) => s.state === "failed") ? "failed" : current?.stop ? "stopped" : "ok";
    run.endedAt = new Date().toISOString();
    await save(run);
  }

  return {
    busy: () => !!current,
    stop() {
      if (current) current.stop = true;
      return !!current;
    },
    async start(prompt) {
      if (current) throw Object.assign(new Error("A run is already in progress."), { status: 409 });
      const mesh = await env.store.mesh();
      const order = runOrder(mesh);
      if (!order.some((b) => !skipReason(b))) throw Object.assign(new Error("No brick is switched on and ready to run."), { status: 400 });
      const run = {
        id: Date.now().toString(36),
        prompt,
        folder: null,
        state: "running",
        startedAt: new Date().toISOString(),
        ctx: { prompt },
        steps: order.map((b) => {
          const why = skipReason(b);
          return { brick: b.id, label: b.label, state: why ? "skipped" : "waiting", detail: why };
        }),
      };
      current = { run };
      await save(run);
      execute(run, mesh)
        .catch(async (e) => {
          env.log(`Run ${run.id} crashed: ${e.message}`);
          run.state = "failed";
          for (const s of run.steps) if (s.state === "running" || s.state === "waiting") Object.assign(s, { state: "failed", error: `IdeaMesh error: ${e.message}` });
          await save(run).catch(() => env.emit(run));
        })
        .finally(() => (current = null));
      return run;
    },
    /** Rerun one failed brick of an earlier run, with the context that run left behind. */
    async rerun(runId, brickId) {
      if (current) throw Object.assign(new Error("Wait for the current run to finish."), { status: 409 });
      const run = (await env.store.runs()).find((r) => r.id === runId);
      const s = run?.steps.find((x) => x.brick === brickId);
      if (!s) throw Object.assign(new Error("That run or brick doesn't exist."), { status: 404 });
      if (s.state !== "failed") throw Object.assign(new Error("Only a failed brick can be rerun."), { status: 400 });
      const mesh = await env.store.mesh();
      const brick = mesh.bricks.find((b) => b.id === brickId);
      current = { run };
      run.state = "running";
      step(run, s, brick)
        .then(async () => {
          run.state = run.steps.some((x) => x.state === "failed") ? "failed" : "ok";
          await save(run);
        })
        .catch((e) => env.log(`Rerun crashed: ${e.message}`))
        .finally(() => (current = null));
      return run;
    },
  };
}
