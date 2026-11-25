import fs from "node:fs/promises";
import path from "node:path";

export const STATUSES = {
  red: { emoji: "🔴", label: "Idea" },
  yellow: { emoji: "🟡", label: "Prototype" },
  green: { emoji: "🟢", label: "Done" },
};
const EMOJI_TO_KEY = Object.fromEntries(Object.entries(STATUSES).map(([k, v]) => [v.emoji, k]));
const EMOJI_RE = /🔴|🟡|🟢/u;

/** `## Status` section: returns { start, end } line indexes (end exclusive), or null. */
function findStatusSection(lines) {
  const start = lines.findIndex((l) => /^##\s+Status\b/i.test(l));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  if (end === -1) end = lines.length;
  return { start, end };
}

export function parseReadme(text) {
  const lines = text.split(/\r?\n/);
  const title = (lines.find((l) => /^#\s+/.test(l)) || "").replace(/^#\s+/, "").trim();
  const tagline = (lines.find((l) => /^>\s+/.test(l)) || "").replace(/^>\s+/, "").trim();
  let status = null;
  let statusText = "";
  const sec = findStatusSection(lines);
  const scan = sec ? lines.slice(sec.start + 1, sec.end) : lines.filter((l) => /^\**Status:?\**/i.test(l));
  for (const l of scan) {
    const m = l.match(EMOJI_RE);
    if (m) {
      status = EMOJI_TO_KEY[m[0]];
      statusText = l.replace(EMOJI_RE, "").replace(/\*\*/g, "").trim();
      break;
    }
  }
  return { title, tagline, status, statusText };
}

/** Rewrite the status line: swap the light and the bold label, keep the explanation after it. */
export function setReadmeStatus(text, key) {
  const s = STATUSES[key];
  if (!s) throw new Error(`Unknown status ${key}`);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const sec = findStatusSection(lines);
  const fresh = `${s.emoji} **${s.label}.**`;
  if (!sec) {
    lines.push("", "## Status", "", fresh, "");
    return lines.join(eol);
  }
  for (let i = sec.start + 1; i < sec.end; i++) {
    if (EMOJI_RE.test(lines[i])) {
      // "🟡 **Prototype.** It works..." -> "🟢 **Done.** It works..."
      const rest = lines[i].replace(/^\s*(🔴|🟡|🟢)\s*(\*\*[^*]*\*\*)?\s*/u, "");
      lines[i] = rest ? `${fresh} ${rest}` : fresh;
      return lines.join(eol);
    }
  }
  lines.splice(sec.start + 1, 0, "", fresh);
  return lines.join(eol);
}

const IDEA_DIR_RE = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

/** Every top-level `yyyy-mm-dd-<slug>` folder with a README.md is an idea (the app's own folders don't match). */
export async function listIdeas(repoPath) {
  const entries = await fs.readdir(repoPath, { withFileTypes: true });
  const ideas = [];
  for (const e of entries) {
    if (!e.isDirectory() || !IDEA_DIR_RE.test(e.name)) continue;
    let text;
    try {
      text = await fs.readFile(path.join(repoPath, e.name, "README.md"), "utf8");
    } catch {
      continue;
    }
    const m = e.name.match(IDEA_DIR_RE);
    const files = (await fs.readdir(path.join(repoPath, e.name))).filter((f) => !f.startsWith("."));
    ideas.push({ folder: e.name, date: m[1], files, ...parseReadme(text) });
  }
  ideas.sort((a, b) => b.date.localeCompare(a.date) || a.folder.localeCompare(b.folder));
  return ideas;
}

export async function updateIdeaStatus(repoPath, folder, key) {
  if (!/^[\w.-]+$/.test(folder)) throw new Error("Bad folder name");
  const file = path.join(repoPath, folder, "README.md");
  const text = await fs.readFile(file, "utf8");
  await fs.writeFile(file, setReadmeStatus(text, key), "utf8");
}
