import fs from "node:fs/promises";
import path from "node:path";

/** The brick network you start with. Positions are canvas pixels on an 8px grid. */
export function defaultMesh() {
  return {
    bricks: [
      {
        id: "passrotor", label: "PassRotor", version: 1, ring: "yellow", runs: false, enabled: true,
        x: 168, y: 64, takes: "-", gives: "Credentials (display only for now)",
        checks: { sketchApproved: true }, settings: {},
        note: "An earlier idea plugged in as a brick. It is shown in the network but not called during runs yet.",
      },
      {
        id: "repo", label: "Ideas repo", version: 1, ring: "green", runs: true, enabled: true,
        x: 168, y: 200, takes: "Prompt", gives: "Dated idea folder with README, committed locally",
        checks: { sketchApproved: true },
        settings: { commit: true },
        note: "Writes the README through Idea Cooker (Claude), then commits that folder. It never pushes.",
      },
      {
        id: "portfolio", label: "Portfolio + text", version: 1, ring: "yellow", runs: true, enabled: true,
        x: 392, y: 200, takes: "Idea folder", gives: "Entry in portfolio.json (Backstage Folio format)",
        checks: { sketchApproved: true },
        settings: { tone: "personal", kind: "hobby" },
        note: "Generates a title, summary and description from the README.",
      },
      {
        id: "website", label: "Website · local folder", version: 1, ring: "yellow", runs: true, enabled: true,
        x: 616, y: 200, takes: "Portfolio entry", gives: "Page in site/<idea>/",
        checks: { sketchApproved: true }, settings: {},
        note: "Writes a static page for the idea and updates site/index.html. Nothing is published.",
      },
      {
        id: "recap", label: "Weekly recap", version: 1, ring: "red", runs: false, enabled: false,
        x: 168, y: 336, takes: "Ideas from the last 7 days", gives: "A short recap",
        checks: { sketchApproved: false }, settings: {},
        note: "Sketched only. It can join runs once its sketch is approved on the Cooker page.",
      },
    ],
    connections: [
      { from: "prompt", to: "repo" },
      { from: "passrotor", to: "repo", dashed: true },
      { from: "recap", to: "repo", dashed: true },
      { from: "repo", to: "portfolio" },
      { from: "portfolio", to: "website" },
    ],
  };
}

export const SETTING_OPTIONS = {
  repo: { commit: [true, false] },
  portfolio: { tone: ["personal", "plain", "technical"], kind: ["hobby", "university", ""] },
};

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback();
    throw new Error(`${path.basename(file)} is not valid JSON: ${e.message}`);
  }
}

// Writes go one at a time, and the rename is retried: on Windows (and in OneDrive folders)
// it fails briefly while another request is reading the same file.
let queue = Promise.resolve();
function writeJson(file, data) {
  const job = queue.then(async () => {
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
    for (let i = 0; ; i++) {
      try {
        return await fs.rename(tmp, file);
      } catch (e) {
        if (i >= 20 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw e;
        await new Promise((r) => setTimeout(r, 25));
      }
    }
  });
  queue = job.catch(() => {});
  return job;
}

export function store(dataDir) {
  const meshFile = path.join(dataDir, "mesh.json");
  const runsFile = path.join(dataDir, "runs.json");
  const portfolioFile = path.join(dataDir, "portfolio.json");
  return {
    dataDir,
    siteDir: path.join(dataDir, "site"),
    portfolioFile,
    async mesh() {
      const m = await readJson(meshFile, defaultMesh);
      if (!Array.isArray(m.bricks) || !Array.isArray(m.connections)) throw new Error("mesh.json needs 'bricks' and 'connections' lists.");
      return m;
    },
    saveMesh: (m) => writeJson(meshFile, m),
    runs: () => readJson(runsFile, () => []),
    saveRuns: (r) => writeJson(runsFile, r.slice(0, 50)),
    portfolio: () => readJson(portfolioFile, () => ({ profile: { name: "", role: "", intro: "", photo: "" }, items: [] })),
    savePortfolio: (p) => writeJson(portfolioFile, p),
  };
}

/** Apply a change from the inspector: only `enabled` and known setting values are accepted. */
export function patchBrick(mesh, id, patch) {
  const b = mesh.bricks.find((x) => x.id === id);
  if (!b) throw Object.assign(new Error(`No brick called ${id}.`), { status: 404 });
  if ("enabled" in patch) {
    if (!b.runs && patch.enabled) throw Object.assign(new Error(`${b.label} can't run yet, so it can't be switched on.`), { status: 400 });
    b.enabled = !!patch.enabled;
  }
  for (const [k, v] of Object.entries(patch.settings || {})) {
    const allowed = SETTING_OPTIONS[id]?.[k];
    if (!allowed || !allowed.includes(v)) throw Object.assign(new Error(`'${v}' isn't a valid value for ${k}.`), { status: 400 });
    b.settings[k] = v;
  }
  return b;
}

/** The bricks a run calls, in order: follow the solid connections from the prompt. */
export function runOrder(mesh) {
  const order = [];
  let at = "prompt";
  const seen = new Set();
  for (;;) {
    const next = mesh.connections.find((c) => c.from === at && !c.dashed);
    if (!next || seen.has(next.to)) break;
    seen.add(next.to);
    const b = mesh.bricks.find((x) => x.id === next.to);
    if (!b) break;
    order.push(b);
    at = b.id;
  }
  return order;
}

/** Why a brick is skipped, or null when it runs. Sketch approved is the first check layer. */
export function skipReason(b) {
  if (!b.runs) return "Not runnable yet";
  if (!b.checks?.sketchApproved) return "Sketch not approved";
  if (!b.enabled) return "Switched off";
  return null;
}
