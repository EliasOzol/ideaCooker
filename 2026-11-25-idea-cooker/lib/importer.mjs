import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git } from "./git.mjs";
import { today } from "./generate.mjs";

const SKIP = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", ".DS_Store", "Thumbs.db", ".idea", ".vscode"]);
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 3000;

export const kebab = (s) =>
  String(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "imported-idea";

/**
 * Understands:
 *   https://github.com/owner/repo[.git]
 *   https://github.com/owner/repo/tree/<branch>/<sub/folder>
 *   any other git URL (https://..., git@...:...)
 *   a local folder path
 */
export async function parseSource(input) {
  const s = String(input || "").trim();
  if (!s) throw new Error("Paste a repository link or a folder path.");
  const gh = s.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/tree\/([^/\s]+)(?:\/(.+?))?)?\/?(?:[#?].*)?$/i);
  if (gh) {
    const [, owner, repo, ref, sub] = gh;
    return { kind: "git", url: `https://github.com/${owner}/${repo}.git`, ref: ref || null, subpath: sub ? decodeURIComponent(sub) : "", name: sub ? sub.split("/").pop() : repo, label: s.replace(/\/$/, "") };
  }
  if (/^(https?:\/\/|git@|ssh:\/\/)/i.test(s)) {
    const name = s.replace(/\.git$/, "").split(/[/:]/).pop();
    return { kind: "git", url: s, ref: null, subpath: "", name, label: s };
  }
  const stat = await fs.stat(s).catch(() => null);
  if (!stat?.isDirectory()) throw new Error("That's not a repository link or an existing folder.");
  return { kind: "local", dir: path.resolve(s), name: path.basename(path.resolve(s)), label: path.resolve(s) };
}

async function walk(dir, rel = "") {
  const out = [];
  for (const e of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...(await walk(dir, r)));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/** Date of the first commit that touched the source, so old ideas keep their real date. */
async function firstCommitDate(dir, subpath) {
  const r = await git(dir, ["log", "--reverse", "--format=%cs", "--", subpath || "."]);
  const d = r.code === 0 ? r.stdout.split("\n")[0].trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/**
 * Copy the source into a new `<date>-<slug>/` folder in the ideas repo.
 * Returns { folder, date, source, fileCount }.
 */
export async function importIntoRepo({ repoPath, input, date: forcedDate, log }) {
  const src = await parseSource(input);
  let tmp = null;
  let from;
  let date = forcedDate || null;
  try {
    if (src.kind === "git") {
      tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-import-"));
      const args = ["clone", "--filter=blob:none", "--quiet", ...(src.ref ? ["--branch", src.ref] : []), src.url, path.join(tmp, "repo")];
      log(`git clone ${src.url}${src.ref ? ` (${src.ref})` : ""}`);
      const r = await git(tmp, args);
      if (r.code !== 0) throw new Error(`Couldn't clone ${src.url}: ${r.stderr || r.stdout}`);
      from = path.join(tmp, "repo", src.subpath);
      if (!date) date = await firstCommitDate(path.join(tmp, "repo"), src.subpath);
    } else {
      from = src.dir;
      if (!date) date = await firstCommitDate(src.dir, ".");
    }
    date ||= today();
    const stat = await fs.stat(from).catch(() => null);
    if (!stat?.isDirectory()) throw new Error(`${src.subpath || from} isn't a folder.`);

    const files = await walk(from);
    if (!files.length) throw new Error("There are no files to import.");
    if (files.length > MAX_FILES) throw new Error(`That's ${files.length} files, more than ${MAX_FILES}. Link a subfolder instead.`);
    let bytes = 0;
    for (const f of files) bytes += (await fs.stat(path.join(from, f))).size;
    if (bytes > MAX_BYTES) throw new Error(`That's ${(bytes / 1e6).toFixed(0)} MB, more than ${MAX_BYTES / 1e6} MB. Link a subfolder instead.`);

    const existing = new Set((await fs.readdir(repoPath)).map((n) => n.toLowerCase()));
    const slug = kebab(String(src.name).replace(/^\d{4}-\d{2}-\d{2}-/, ""));
    let folder = `${date}-${slug}`;
    for (let i = 2; existing.has(folder.toLowerCase()); i++) folder = `${date}-${slug}-${i}`;

    const dest = path.join(repoPath, folder);
    for (const f of files) {
      await fs.mkdir(path.dirname(path.join(dest, f)), { recursive: true });
      await fs.copyFile(path.join(from, f), path.join(dest, f));
    }
    log(`Copied ${files.length} files (${(bytes / 1e3).toFixed(0)} kB) into ${folder}/`);
    return { folder, date, source: src.label, fileCount: files.length };
  } finally {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
