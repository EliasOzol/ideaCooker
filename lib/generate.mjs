import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_README = path.join(here, "..", "example", "README.md");

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function buildPrompt(idea, date, example, existing) {
  return `You are helping with a "daily idea" practice. Every day the user writes down one idea, and it gets a README and a small, working prototype in their daily-ideas git repository (your current working directory).

Today's idea, in the user's words:
<idea>
${idea}
</idea>

Do this:
1. Pick a short, catchy name for the idea and a kebab-case slug (2-4 words, lowercase a-z, 0-9 and hyphens).
2. Create exactly ONE new folder in the repository root named \`${date}-<slug>\`. Write files only inside that folder. These folders already exist, so do not use or touch them: ${existing.length ? existing.join(", ") : "(none)"}. (The repo root also holds the Idea Cooker app itself; ignore its code.)
3. Write \`README.md\` in that folder, following the example below: an H1 title with an emoji or two, a one-line \`>\` tagline, a "**Daily idea · ${date}**" line, then the sections "## The idea", "## Why", "## The prototype" (with a "### Run it" subsection giving a PowerShell command), "## Status" and "## Next steps" (a checklist). Write in English.
4. The "## Status" section must start with exactly one traffic light and a bold label, then one sentence: "🔴 **Idea.**" (nothing runs yet), "🟡 **Prototype.**" (a working prototype with clear gaps) or "🟢 **Done.**". A freshly built prototype is normally 🟡.
5. Build a small prototype that actually works. Prefer a single self-contained \`index.html\` (inline CSS and JS, no build step, no external network calls unless the idea needs them) that opens by double-clicking. If the idea really needs something else (a Python script, an Arduino sketch, a CLI), keep it to a few files with no install step where possible, and explain how to run it in the README.
6. Keep it small: the prototype should demonstrate the core mechanic of the idea well, not be a full product. Make it look good.
7. Do not run any shell commands and do not use git; the app that called you commits and pushes.

When you're done, reply with one line: the folder name you created.

Here is the README of an earlier idea, as the example of format and tone:
<example_readme>
${example}
</example_readme>`;
}

/**
 * Ask Claude (via the Claude Agent SDK, which uses the local Claude Code login)
 * to write README.md + prototype into a new `<date>-<slug>/` folder.
 * Returns the folder name. Writes are confined to that one new folder.
 */
export async function generateIdea({ repoPath, idea, model, log, signal }) {
  const date = today();
  const existing = (await fs.readdir(repoPath, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);
  const existingLower = new Set(existing.map((n) => n.toLowerCase()));

  if (process.env.IDEA_COOKER_FAKE === "1") return fakeGenerate({ repoPath, idea, date, existingLower, log });

  const example = await fs.readFile(EXAMPLE_README, "utf8");
  const root = path.resolve(repoPath);
  const folderRe = new RegExp(`^${date}-[a-z0-9][a-z0-9-]{0,60}$`);
  let chosen = null;

  const inside = (p) => {
    const rel = path.relative(root, path.resolve(root, String(p)));
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  };

  // Reads stay inside the repo; writes only inside one new, correctly named folder.
  const canUseTool = async (toolName, input) => {
    if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") {
      const p = input.file_path ?? input.path ?? ".";
      return inside(p) ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "Only read files inside the repository." };
    }
    if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit" || toolName === "NotebookEdit") {
      const target = String(input.file_path || input.notebook_path || "");
      const abs = path.resolve(root, target);
      const rel = path.relative(root, abs);
      const first = rel.split(path.sep)[0];
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || first === rel) {
        return { behavior: "deny", message: `Write files only inside a new ${date}-<slug>/ folder in the repo root.` };
      }
      if (!folderRe.test(first)) return { behavior: "deny", message: `Folder must be named ${date}-<kebab-slug> (lowercase).` };
      if (existingLower.has(first.toLowerCase())) return { behavior: "deny", message: `${first} already exists; pick another slug.` };
      if (chosen && chosen !== first) return { behavior: "deny", message: `Use the folder you already created: ${chosen}.` };
      chosen = first;
      log(`✍️  ${toolName} ${rel.replaceAll("\\", "/")}`);
      return { behavior: "allow", updatedInput: input };
    }
    return { behavior: "deny", message: `${toolName} isn't available here. Use Read, Glob, Grep, Write and Edit only.` };
  };

  const abortController = new AbortController();
  signal?.addEventListener("abort", () => abortController.abort());

  log(`Asking Claude${model ? ` (${model})` : ""}…`);
  let result = null;
  for await (const m of query({
    prompt: buildPrompt(idea, date, example, existing),
    options: {
      cwd: root,
      model: model || undefined,
      allowedTools: [],
      disallowedTools: ["Bash", "PowerShell", "WebFetch", "WebSearch", "Task", "Agent"],
      canUseTool,
      maxTurns: 40,
      abortController,
    },
  })) {
    if (m.type === "assistant") {
      for (const b of m.message?.content || []) {
        if (b.type === "text" && b.text.trim()) log(`💬 ${b.text.trim().slice(0, 300)}`);
      }
    } else if (m.type === "result") {
      result = m;
    }
  }
  if (!result) throw new Error("Claude ended without a result.");
  if (result.is_error || result.subtype !== "success") {
    const why = result.result || (result.errors || []).join("; ") || result.subtype;
    throw new Error(/log ?in/i.test(why) ? `${why}. Run \`claude\` once in a terminal and use /login, then try again.` : why);
  }
  if (typeof result.total_cost_usd === "number" && result.total_cost_usd > 0) log(`Done in ${result.num_turns} turns (≈ $${result.total_cost_usd.toFixed(3)}).`);
  if (!chosen) throw new Error("Claude didn't write any files.");
  await fs.access(path.join(root, chosen, "README.md")).catch(() => {
    throw new Error(`${chosen}/README.md is missing.`);
  });
  return chosen;
}

/** Test double: IDEA_COOKER_FAKE=1 skips Claude and writes a canned idea, to test the git + UI flow. */
async function fakeGenerate({ repoPath, idea, date, existingLower, log }) {
  let slug = idea.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 3).join("-") || "idea";
  let folder = `${date}-${slug}`;
  for (let i = 2; existingLower.has(folder.toLowerCase()); i++) folder = `${date}-${slug}-${i}`;
  log(`[fake mode] writing ${folder}/ without calling Claude`);
  await fs.mkdir(path.join(repoPath, folder));
  await fs.writeFile(
    path.join(repoPath, folder, "README.md"),
    `# 🧪 ${idea.slice(0, 40)}\n\n> Fake idea written by the idea-cooker test mode.\n\n**Daily idea · ${date}**\n\n## The idea\n\n${idea}\n\n## Why\n\n- Testing\n\n## The prototype\n\n[\`index.html\`](index.html)\n\n### Run it\n\n\`\`\`powershell\nstart index.html\n\`\`\`\n\n## Status\n\n🟡 **Prototype.** Test content only.\n\n## Next steps\n\n- [ ] Replace with a real idea\n`,
  );
  await fs.writeFile(path.join(repoPath, folder, "index.html"), `<!doctype html><title>${folder}</title><h1>${folder}</h1>\n`);
  return folder;
}
