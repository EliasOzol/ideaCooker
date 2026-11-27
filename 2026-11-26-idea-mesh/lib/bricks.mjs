import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Idea Cooker's modules, loaded from its folder so its node_modules (the Claude SDK) resolve there. */
export async function loadCooker(cookerDir) {
  const lib = (f) => import(pathToFileURL(path.join(cookerDir, "lib", f)).href);
  const [generate, git, ideas, chats, sketch] = await Promise.all(["generate.mjs", "git.mjs", "ideas.mjs", "chats.mjs", "sketch.mjs"].map(lib));
  let sdk = null;
  const getSdk = async () =>
    (sdk ??= await import(pathToFileURL(path.join(cookerDir, "node_modules", "@anthropic-ai", "claude-agent-sdk", "sdk.mjs")).href).catch(() => {
      throw new Error(`Claude SDK not found. Run npm install in ${path.basename(cookerDir)} first.`);
    }));
  return { dir: cookerDir, generate, git, ideas, chats, sketch, getSdk };
}

const FAKE = () => process.env.IDEA_COOKER_FAKE === "1";

/** Pull the parts of an idea README the later bricks need. */
export function readReadme(text) {
  const title = (text.match(/^#\s+(.+)$/m)?.[1] || "").replace(/[^\p{L}\p{N}\s.,:'&+-]/gu, "").trim();
  const tagline = (text.match(/^>\s*(.+)$/m)?.[1] || "").trim();
  const section = (name) => {
    const m = text.match(new RegExp(`^##\\s+${name}\\s*$([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, "m"));
    return m ? m[1].trim() : "";
  };
  return { title, tagline, idea: section("The idea"), why: section("Why"), status: section("Status").split("\n")[0] || "" };
}

/** Ideas repo brick: Idea Cooker writes `<date>-<slug>/README.md`, then that folder is committed (never pushed). */
async function repoBrick({ ctx, brick, env, log }) {
  // An idea cooked on the Cooker page arrives with its folder already written and committed.
  if (ctx.folder) {
    ctx.readme = await fs.readFile(path.join(env.repoPath, ctx.folder, "README.md"), "utf8");
    return { detail: `Used the cooked idea ${ctx.folder}` };
  }
  const r = await env.cooker.generate.cookIdea({
    repoPath: env.repoPath, idea: ctx.prompt, saveOnly: true, model: env.model, rules: env.rules, log,
  });
  ctx.folder = r.folder;
  ctx.readme = await fs.readFile(path.join(env.repoPath, r.folder, "README.md"), "utf8");
  if (!brick.settings.commit) return { detail: `Wrote ${r.folder}/README.md (commit is off)` };
  const c = await env.cooker.git.commitAndPush(env.repoPath, [r.folder], `IdeaMesh: ${r.folder}`, { push: false, log });
  ctx.sha = c.sha || null;
  return { detail: c.committed ? `Committed ${c.sha} locally` : `Wrote ${r.folder}`, link: null };
}

const TONES = {
  personal: "first person, warm and direct, like a maker describing their own project",
  plain: "neutral and factual",
  technical: "precise, naming the techniques and parts involved",
};

/** Ask Claude for portfolio text. No tools: the README is in the prompt, and the answer is JSON. */
async function portfolioText({ readme, tone, env }) {
  if (FAKE()) {
    const r = readReadme(readme);
    return { title: r.title || "Untitled idea", summary: r.tagline, description: r.idea, tags: ["Daily idea"] };
  }
  const { query } = await env.cooker.getSdk();
  const prompt = `Write a portfolio entry for this project, based only on its README. Tone: ${TONES[tone] || TONES.plain}. No hype words and no emoji.
Reply with only a JSON object: {"title": "...", "summary": "one sentence, max 120 characters", "description": "2-3 short paragraphs separated by blank lines", "tags": ["2-3 short tags"]}

<readme>
${readme}
</readme>`;
  let result = null;
  for await (const m of query({
    prompt,
    options: {
      cwd: env.repoPath, model: env.model || undefined, maxTurns: 1, allowedTools: [],
      canUseTool: async () => ({ behavior: "deny", message: "No tools in this step." }),
    },
  })) if (m.type === "result") result = m;
  if (!result || result.is_error || result.subtype !== "success") {
    const why = result?.result || result?.subtype || "no result";
    throw new Error(/log ?in/i.test(why) ? `${why}. Run \`claude\` once in a terminal and use /login.` : `Claude: ${why}`);
  }
  const json = String(result.result).match(/\{[\s\S]*\}/)?.[0];
  try {
    const p = JSON.parse(json);
    if (!p.title || !p.summary) throw new Error("missing title or summary");
    return p;
  } catch (e) {
    throw new Error(`Claude's portfolio text wasn't valid JSON (${e.message}).`);
  }
}

const hueOf = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/** Portfolio brick: upsert an item in portfolio.json, in Backstage Folio's import shape. */
async function portfolioBrick({ ctx, brick, env }) {
  if (!ctx.readme) throw new Error("No README to write from. The Ideas repo brick has to succeed first.");
  const t = await portfolioText({ readme: ctx.readme, tone: brick.settings.tone, env });
  const pf = await env.store.portfolio();
  const item = {
    id: ctx.folder,
    title: String(t.title),
    summary: String(t.summary),
    description: String(t.description || ""),
    year: ctx.folder.slice(0, 4),
    tags: Array.isArray(t.tags) ? t.tags.map(String).slice(0, 4) : [],
    link: "",
    hue: hueOf(ctx.folder),
    hidden: false,
    image: "",
    kind: brick.settings.kind ?? "hobby",
    course: "",
    courseUrl: "",
  };
  const i = pf.items.findIndex((x) => x.id === item.id);
  if (i >= 0) pf.items[i] = item;
  else pf.items.unshift(item);
  await env.store.savePortfolio(pf);
  ctx.entry = item;
  return { detail: `Added "${item.title}" to portfolio.json`, link: "/portfolio.json" };
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const PAGE_CSS = `:root{color-scheme:light dark;--bg:#f6f3ee;--ink:#1f1c18;--muted:#6b645b;--accent:#b4472b}
@media (prefers-color-scheme:dark){:root{--bg:#171513;--ink:#ece6dd;--muted:#a39b90;--accent:#e07a5c}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:48px 24px}
h1{font-size:32px;line-height:1.2;margin:0 0 8px}p.lede{color:var(--muted);font-size:18px;margin:0 0 32px}
a{color:var(--accent)}ul{padding-left:20px}li{margin:0 0 8px}small{color:var(--muted)}`;

/** Website brick: a static page per idea in site/<folder>/, plus an index. Local only. */
async function websiteBrick({ ctx, env }) {
  const e = ctx.entry;
  if (!e) throw new Error("No portfolio entry to publish. The Portfolio brick has to succeed first.");
  const dir = path.join(env.store.siteDir, ctx.folder);
  await fs.mkdir(dir, { recursive: true });
  const paras = e.description.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n");
  await fs.writeFile(
    path.join(dir, "index.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(e.title)}</title><style>${PAGE_CSS}</style>
<main><small><a href="../">All ideas</a> · ${esc(ctx.folder.slice(0, 10))}</small><h1>${esc(e.title)}</h1><p class="lede">${esc(e.summary)}</p>${paras}</main></html>\n`,
  );
  const pf = await env.store.portfolio();
  const rows = pf.items.filter((i) => !i.hidden).map((i) => `<li><a href="${encodeURIComponent(i.id)}/">${esc(i.title)}</a><br><small>${esc(i.summary)}</small></li>`).join("\n");
  await fs.writeFile(
    path.join(env.store.siteDir, "index.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ideas</title><style>${PAGE_CSS}</style>
<main><h1>Ideas</h1><p class="lede">One idea a day, from the IdeaMesh.</p><ul>${rows}</ul></main></html>\n`,
  );
  return { detail: `Wrote site/${ctx.folder}/index.html` };
}

export const BRICKS = { repo: repoBrick, portfolio: portfolioBrick, website: websiteBrick };
