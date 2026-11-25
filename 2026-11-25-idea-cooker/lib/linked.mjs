import fs from "node:fs/promises";
import path from "node:path";
import { git, inspectRepo } from "./git.mjs";

/**
 * Linked repos: an idea can point at its own git repository (e.g. github.com/you/project).
 * The app keeps a clone of it in `reposDir`, lets Claude read and edit that clone,
 * and commits + pushes changes to the original repository.
 * The link is stored in `<idea folder>/idea.json` as { "repo": "<url>" }.
 */

const LINK_FILE = "idea.json";

/** GitHub web or clone URL -> { url, key, name, label }. Other git URLs are accepted as-is. */
export function parseRepoUrl(input) {
  const s = String(input || "").trim();
  const gh = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/.*)?\/?(?:[#?].*)?$/i);
  if (gh) {
    const [, owner, repo] = gh;
    return { url: `https://github.com/${owner}/${repo}.git`, key: `${owner}-${repo}`.toLowerCase(), name: repo, label: `github.com/${owner}/${repo}`, web: `https://github.com/${owner}/${repo}` };
  }
  if (/^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/i.test(s)) {
    const name = s.replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).pop() || "repo";
    const key = s.replace(/^[a-z]+:\/+/i, "").replace(/\.git$/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(-80);
    return { url: s, key, name, label: s, web: /^https?:/i.test(s) ? s.replace(/\.git$/, "") : null };
  }
  throw new Error("That doesn't look like a repository link.");
}

/** Every github.com/owner/repo link in a piece of text (deduplicated). */
export function findRepoLinks(text) {
  const out = new Map();
  for (const m of String(text || "").matchAll(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+/gi)) {
    try {
      const r = parseRepoUrl(m[0].replace(/[.,;:)]+$/, ""));
      out.set(r.key, r);
    } catch {}
  }
  return [...out.values()];
}

export async function readLink(repoPath, folder) {
  try {
    const j = JSON.parse(await fs.readFile(path.join(repoPath, folder, LINK_FILE), "utf8"));
    return j && j.repo ? j : null;
  } catch {
    return null;
  }
}

export async function writeLink(repoPath, folder, link) {
  await fs.writeFile(path.join(repoPath, folder, LINK_FILE), JSON.stringify(link, null, 2) + "\n", "utf8");
}

export function cloneDir(reposDir, repo) {
  return path.join(reposDir, repo.key);
}

/** Clone the repo, or fast-forward an existing clone. Returns the clone's path. */
export async function ensureClone(reposDir, repoInput, log) {
  const repo = typeof repoInput === "string" ? parseRepoUrl(repoInput) : repoInput;
  const dir = cloneDir(reposDir, repo);
  await fs.mkdir(reposDir, { recursive: true });
  const exists = await fs.stat(path.join(dir, ".git")).catch(() => null);
  if (!exists) {
    log(`git clone ${repo.url}`);
    const r = await git(reposDir, ["clone", "--quiet", repo.url, dir]);
    if (r.code !== 0) throw new Error(`Couldn't clone ${repo.label}: ${r.stderr || r.stdout}`);
  } else {
    const info = await inspectRepo(dir);
    if (info.upstream) {
      log(`git pull --ff-only (${repo.label})`);
      const r = await git(dir, ["pull", "--ff-only", "--quiet"]);
      if (r.code !== 0) throw new Error(`Couldn't update the clone of ${repo.label} (${dir}): ${r.stderr || r.stdout}`);
    }
  }
  await excludeRunLeftovers(dir);
  return dir;
}

// Files that running a project creates. Excluded locally (.git/info/exclude), so they're never
// committed to the user's repo, without changing the repo's own .gitignore.
const LEFTOVERS = ["node_modules/", ".venv/", "venv/", "__pycache__/", "*.pyc", "coverage/", ".nyc_output/", "*.log", ".DS_Store", "Thumbs.db"];
async function excludeRunLeftovers(dir) {
  const file = path.join(dir, ".git", "info", "exclude");
  const current = await fs.readFile(file, "utf8").catch(() => "");
  const missing = LEFTOVERS.filter((l) => !current.split(/\r?\n/).includes(l));
  if (!missing.length) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${current.endsWith("\n") || !current ? "" : "\n"}# added by Idea Cooker: files that running the project creates\n${missing.join("\n")}\n`);
}

export async function firstCommitDate(dir) {
  const r = await git(dir, ["log", "--reverse", "--format=%cs"]);
  const d = r.code === 0 ? r.stdout.split("\n")[0].trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** Commit everything Claude changed in the clone, then push it to the original repo. */
export async function commitClone(dir, message, { push, log, label }) {
  const status = await git(dir, ["status", "--porcelain"]);
  if (!status.stdout) {
    log(`No changes in ${label}.`);
    return { committed: false, pushed: false };
  }
  let r = await git(dir, ["add", "-A"]);
  if (r.code !== 0) throw new Error(`git add failed in ${label}: ${r.stderr}`);
  r = await git(dir, ["commit", "--quiet", "-m", message]);
  if (r.code !== 0) throw new Error(`git commit failed in ${label}: ${r.stderr || r.stdout}`);
  const sha = (await git(dir, ["rev-parse", "--short", "HEAD"])).stdout;
  log(`Committed ${sha} in ${label}`);
  if (!push) {
    log(`Push is turned off; the commit stays in the local clone of ${label}.`);
    return { committed: true, pushed: false, sha };
  }
  log(`git push (${label})`);
  r = await git(dir, ["push"]);
  if (r.code !== 0) throw new Error(`Couldn't push to ${label}: ${r.stderr || r.stdout}`);
  log(`Pushed to ${label}.`);
  return { committed: true, pushed: true, sha };
}

/** The file the preview panel can open from the clone: a static index.html (not a Vite/npm app). */
export async function staticEntry(dir) {
  const candidates = ["index.html", "docs/index.html", "public/index.html"];
  for (const c of candidates) {
    const f = path.join(dir, c);
    if (!(await fs.stat(f).catch(() => null))) continue;
    const pkg = await fs.stat(path.join(path.dirname(f), "package.json")).catch(() => null);
    const html = await fs.readFile(f, "utf8").catch(() => "");
    // Bundled apps (Vite etc.) reference /src/main.jsx and don't run without a dev server.
    if (pkg || /src=["']\/?src\/main\.[jt]sx?["']/.test(html)) continue;
    return c;
  }
  return null;
}
