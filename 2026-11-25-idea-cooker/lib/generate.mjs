import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_README = path.join(here, "..", "example", "README.md");
const FAKE = () => process.env.IDEA_COOKER_FAKE === "1";

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const README_FORMAT = (date) => `an H1 title with an emoji or two, a one-line \`>\` tagline, a "**Daily idea · ${date}**" line, then the sections "## The idea", "## Why", "## The prototype" (with a "### Run it" subsection giving a PowerShell command), "## Status" and "## Next steps" (a checklist). Write in English.`;

const STATUS_RULE = `The "## Status" section must start with exactly one traffic light and a bold label, then one sentence: "🔴 **Idea.**" (nothing runs yet), "🟡 **Prototype.**" (works, with clear gaps) or "🟢 **Done.**".`;

// Placeholders that runClaude fills in, depending on whether the user lets Claude run commands.
const RULES = "{{RULES}}";
const CHECKS = "{{CHECKS}}";
const RULES_NO_SHELL = `Do not run any shell commands and do not use git; the app that called you commits and pushes.`;
const RULES_SHELL = `You may run shell commands inside the project folder to check your work: run its tests, run scripts, or start a local server in the background (run_in_background) and request it with curl or node. Stop every background process you started before you finish. Don't use git (the app commits and pushes), don't install anything globally, and don't touch files outside the project.`;
const CHECKS_NO_SHELL = `You can't run commands, so you can't run the tests or the app. Read the code carefully instead, and say what the user should run to check your change.`;
const CHECKS_SHELL = `Check your change by running it: run the project's tests (install dependencies first if needed, e.g. npm install), and if it has a local server or test site, start it in the background, request its pages, then stop it. Tell the user what you ran and what passed or failed, and what they still need to try by hand (for example a browser extension in their browser).`;

/** Commands Claude may never run, even with commands allowed. This is a guard, not a sandbox. */
const BLOCKED_COMMANDS = [
  [/\bgit\s+(push|commit|reset|clean|checkout|switch|rebase|merge|remote|config|tag|stash|rm|mv|restore|filter-branch|gc)\b/i, "git is handled by the app"],
  [/\b(npm|pnpm|yarn|bun)\s+(publish|unpublish|adduser|login|logout|token|owner)\b/i, "publishing and logins are off-limits"],
  [/\b(npm|pnpm|yarn|bun)\s+(i|install|add)\b[^&|;]*\s(-g|--global)\b/i, "no global installs"],
  [/\bsudo\b|\brunas\b|\bshutdown\b|\bRestart-Computer\b|\bStop-Computer\b|\bformat\s+[a-z]:/i, "system commands are off-limits"],
  [/\brm\s+-[a-z]*r[a-z]*\s+(-[a-z]+\s+)*["']?(\/|~|\$HOME|[a-z]:|\.\.)/i, "recursive deletes outside the project"],
  [/\bRemove-Item\b[^|;&]*-Recurse|\brmdir\s+\/s\b|\bdel\s+\/s\b/i, "recursive deletes"],
  [/\b(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|]*\|\s*(sh|bash|zsh|iex|Invoke-Expression|powershell|pwsh)\b/i, "piping downloads into a shell"],
  [/\breg(\.exe)?\s+(add|delete|import)\b|\bsetx\b|\bSet-ItemProperty\b[^|]*HK(LM|CU)/i, "registry and system settings"],
  [/\b(ssh|scp)\s|\.ssh[\\/]|credential|\.git-credentials/i, "credentials and remote shells"],
];
export function blockedCommand(cmd) {
  for (const [re, why] of BLOCKED_COMMANDS) if (re.test(String(cmd))) return why;
  return null;
}

async function example() {
  return fs.readFile(EXAMPLE_README, "utf8");
}

async function topFolders(root) {
  return (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
}

/**
 * Run one Claude turn in the repo with writes confined by `scope`:
 *   { type: "new", date, existingLower }  -> exactly one new `<date>-<slug>` folder
 *   { type: "folder", folder }            -> only inside that existing folder
 * Reads are confined to the repo. `emit` receives chat events ({ kind: "assistant" | "tool", text }).
 */
/** The user's own rule sets from Settings, appended to every prompt. */
export function rulesBlock(rules = []) {
  const active = rules.filter((r) => r && r.enabled !== false && String(r.text || "").trim());
  if (!active.length) return "";
  return `\n\nThe user has set rules in their settings. Follow them in everything you write or change, unless the request above explicitly asks for something else:\n${active
    .map((r) => `<rule_set title="${String(r.title || "Rules").replace(/"/g, "'")}">\n${String(r.text).trim()}\n</rule_set>`)
    .join("\n")}`;
}

async function runClaude({ root, prompt: basePrompt, scope, resume, model, rules = [], allowCommands = false, log, emit }) {
  const prompt = (basePrompt + rulesBlock(rules))
    .replaceAll(RULES, allowCommands ? RULES_SHELL : RULES_NO_SHELL)
    .replaceAll(CHECKS, allowCommands ? CHECKS_SHELL : CHECKS_NO_SHELL);
  if (rules.length) log(`Rules: ${rules.map((r) => r.title || "untitled").join(", ")}`);
  if (allowCommands) log("Commands: allowed");
  const folderRe = scope.type === "new" ? new RegExp(`^${scope.date}-[a-z0-9][a-z0-9-]{0,60}$`) : null;
  let chosen = scope.type === "folder" ? scope.folder : null;
  // A linked repo's clone (scope.clone) becomes the working directory; the ideas repo is added next to it.
  const clone = scope.clone ? path.resolve(scope.clone) : null;
  const cwd = clone || root;

  const within = (base, p) => {
    const rel = path.relative(base, path.resolve(cwd, String(p)));
    return !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : null;
  };
  const relOf = (p) => path.relative(root, path.resolve(cwd, String(p)));
  const inside = (p) => within(root, p) !== null || (clone && within(clone, p) !== null);

  const canUseTool = async (toolName, input) => {
    if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") {
      const p = input.file_path ?? input.path ?? ".";
      return inside(p) ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "Only read files inside the repository." };
    }
    if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit" || toolName === "NotebookEdit") {
      const target = String(input.file_path || input.notebook_path || "");
      const inClone = clone ? within(clone, target) : null;
      if (inClone !== null && clone) {
        if (!scope.cloneWritable) return { behavior: "deny", message: `Don't change ${scope.cloneLabel}; only write the idea's README.` };
        if (!inClone || inClone.split(path.sep)[0] === ".git") return { behavior: "deny", message: "Don't touch the .git folder." };
        const shown = `${scope.cloneLabel}/${inClone.replaceAll("\\", "/")}`;
        log(`Write ${shown}`);
        emit({ kind: "tool", text: `${toolName === "Write" ? "Wrote" : "Edited"} ${shown}` });
        return { behavior: "allow", updatedInput: input };
      }
      const rel = relOf(target);
      const first = rel.split(path.sep)[0];
      if (within(root, target) === null || first === rel) return { behavior: "deny", message: "Write files only inside the idea's folder." };
      if (scope.type === "new") {
        if (!folderRe.test(first)) return { behavior: "deny", message: `Folder must be named ${scope.date}-<kebab-slug> (lowercase).` };
        if (scope.existingLower.has(first.toLowerCase())) return { behavior: "deny", message: `${first} already exists; pick another slug.` };
        if (chosen && chosen !== first) return { behavior: "deny", message: `Use the folder you already created: ${chosen}.` };
        chosen = first;
      } else if (first.toLowerCase() !== scope.folder.toLowerCase()) {
        return { behavior: "deny", message: `Only edit files inside ${scope.folder}/.` };
      }
      const shown = rel.replaceAll("\\", "/");
      log(`Write ${shown}`);
      emit({ kind: "tool", text: `${toolName === "Write" ? "Wrote" : "Edited"} ${shown}` });
      return { behavior: "allow", updatedInput: input };
    }
    if (allowCommands && (toolName === "Bash" || toolName === "PowerShell")) {
      const cmd = String(input.command || "");
      const why = blockedCommand(cmd);
      if (why) {
        log(`Blocked command (${why}): ${cmd.slice(0, 200)}`);
        return { behavior: "deny", message: `Not allowed here: ${why}.` };
      }
      const short = cmd.replace(/\s+/g, " ").trim();
      log(`Run ${short.slice(0, 300)}${input.run_in_background ? " (background)" : ""}`);
      emit({ kind: "tool", text: `Ran ${short.length > 70 ? short.slice(0, 67) + "…" : short}${input.run_in_background ? " (background)" : ""}` });
      return { behavior: "allow", updatedInput: input };
    }
    // Reading the output of, or stopping, a background command Claude started.
    if (allowCommands && /^(TaskStop|TaskOutput|BashOutput|KillShell|KillBash|Monitor)$/.test(toolName)) {
      return { behavior: "allow", updatedInput: input };
    }
    return { behavior: "deny", message: `${toolName} isn't available here. Use Read, Glob, Grep, Write and Edit only.` };
  };

  const once = async (resumeId) => {
    let result = null;
    let sessionId = resumeId || null;
    const texts = [];
    for await (const m of query({
      prompt,
      options: {
        cwd,
        ...(clone ? { additionalDirectories: [root] } : {}),
        model: model || undefined,
        allowedTools: [],
        disallowedTools: allowCommands ? ["WebFetch", "WebSearch", "Task", "Agent"] : ["Bash", "PowerShell", "WebFetch", "WebSearch", "Task", "Agent"],
        canUseTool,
        maxTurns: allowCommands ? 80 : 40,
        ...(resumeId ? { resume: resumeId } : {}),
      },
    })) {
      if (m.session_id) sessionId = m.session_id;
      if (m.type === "assistant") {
        for (const b of m.message?.content || []) {
          if (b.type === "text" && b.text.trim()) {
            texts.push(b.text.trim());
            log(`Claude: ${b.text.trim().slice(0, 300)}`);
          }
        }
      } else if (m.type === "result") {
        result = m;
      }
    }
    return { result, sessionId, texts };
  };

  log(`Asking Claude${model ? ` (${model})` : ""}…`);
  let run;
  try {
    run = await once(resume);
  } catch (e) {
    if (!resume) throw e;
    log(`Couldn't resume the earlier chat (${e.message.slice(0, 120)}); starting a fresh one.`);
    run = await once(null);
  }
  const { result, sessionId, texts } = run;
  if (!result) throw new Error("Claude ended without a result.");
  if (result.is_error || result.subtype !== "success") {
    const why = result.result || (result.errors || []).join("; ") || result.subtype;
    throw new Error(/log ?in/i.test(why) ? `${why}. Run \`claude\` once in a terminal and use /login, then try again.` : why);
  }
  if (typeof result.total_cost_usd === "number" && result.total_cost_usd > 0) log(`Claude finished in ${result.num_turns} turns, about $${result.total_cost_usd.toFixed(2)}.`);
  const reply = (result.result || texts[texts.length - 1] || "").trim();
  return { sessionId, reply, folder: chosen, cost: result.total_cost_usd };
}

/** New idea: Claude creates `<today>-<slug>/` with README + prototype. */
export async function cookIdea({ repoPath, idea, model, rules = [], allowCommands = false, log, emit = () => {}, saveOnly = false }) {
  const root = path.resolve(repoPath);
  const date = today();
  const existing = await topFolders(root);
  const existingLower = new Set(existing.map((n) => n.toLowerCase()));
  if (FAKE()) return fakeCook({ root, idea, date, existingLower, log, emit, saveOnly, rules });
  if (saveOnly) {
    const prompt = `You are helping with a "daily idea" practice. The user wants to write down an idea now and maybe build it later. Their daily-ideas git repository is your current working directory.

The idea, in the user's words:
<idea>
${idea}
</idea>

Do this:
1. Pick a short, catchy name for the idea and a kebab-case slug (2-4 words, lowercase a-z, 0-9 and hyphens).
2. Create exactly ONE new folder in the repository root named \`${date}-<slug>\`, and write only \`README.md\` in it. These folders already exist, so do not use or touch them: ${existing.length ? existing.join(", ") : "(none)"}.
3. Follow the example below: ${README_FORMAT(date)}
4. There is no prototype yet. Under "## The prototype", write one or two sentences on what a first prototype could be, and leave out "### Run it".
5. The status must be "🔴 **Idea.** Not built yet." The first item under "## Next steps" is "Build a first prototype".
6. Keep it short; don't invent detail the user didn't give. ${RULES}

Reply in 1-2 short sentences: the name you picked and one question or suggestion that would sharpen the idea.

Example README (it has a prototype; yours won't):
<example_readme>
${await example()}
</example_readme>`;
    const r = await runClaude({ root, prompt, scope: { type: "new", date, existingLower }, model, rules, allowCommands, log, emit });
    if (!r.folder) throw new Error("Claude didn't write any files.");
    return r;
  }

  const prompt = `You are helping with a "daily idea" practice. Every day the user writes down one idea, and it gets a README and a small, working prototype in their daily-ideas git repository (your current working directory).

Today's idea, in the user's words:
<idea>
${idea}
</idea>

Do this:
1. Pick a short, catchy name for the idea and a kebab-case slug (2-4 words, lowercase a-z, 0-9 and hyphens).
2. Create exactly ONE new folder in the repository root named \`${date}-<slug>\`. Write files only inside that folder. These folders already exist, so do not use or touch them: ${existing.length ? existing.join(", ") : "(none)"}. (One of them holds the Idea Cooker app that is running you; ignore its code.)
3. Write \`README.md\` in that folder, following the example below: ${README_FORMAT(date)}
4. ${STATUS_RULE} A freshly built prototype is normally 🟡.
5. Build a small prototype that actually works. Prefer a single self-contained \`index.html\` (inline CSS and JS, no build step, no external network calls unless the idea needs them) that opens by double-clicking. If the idea really needs something else (a Python script, an Arduino sketch, a CLI), keep it to a few files with no install step where possible, and explain how to run it in the README.
6. Keep it small: the prototype should demonstrate the core mechanic of the idea well, not be a full product. Make it look good.
7. ${RULES}

The user will see your final reply in a chat next to the prototype, and may ask for changes afterwards. When you're done, reply in 2-3 short sentences: what you built and what to try first. Don't repeat the README.

Here is the README of an earlier idea, as the example of format and tone:
<example_readme>
${await example()}
</example_readme>`;

  const r = await runClaude({ root, prompt, scope: { type: "new", date, existingLower }, model, rules, allowCommands, log, emit });
  if (!r.folder) throw new Error("Claude didn't write any files.");
  await fs.access(path.join(root, r.folder, "README.md")).catch(() => {
    throw new Error(`${r.folder}/README.md is missing.`);
  });
  return r;
}

/** Follow-up: Claude changes an existing idea, only inside its folder. */
export async function reviseIdea({ repoPath, folder, message, sessionId, model, rules = [], allowCommands = false, log, emit = () => {}, clone = null, cloneLabel = "" }) {
  const root = path.resolve(repoPath);
  if (FAKE()) return fakeRevise({ root, folder, message, log, emit, clone, cloneLabel });
  if (clone) {
    const ideaDir = path.join(root, folder);
    const prompt = `You're working on the user's project ${cloneLabel}. Its code is in your current working directory (a git clone of that repository). The project is also one of the user's daily ideas; its idea notes are in \`${ideaDir}${path.sep}README.md\`, in a separate ideas repository.

If you haven't looked at the project in this conversation yet, read its README and the relevant code first.

The user's request:
<request>
${message}
</request>

Rules:
- Make code changes in the project (your working directory). Keep changes focused on the request and match the project's existing style.
- ${CHECKS}
- If the change affects what the idea notes say (what works, status, next steps), update \`${ideaDir}${path.sep}README.md\` too. Keep its format. ${STATUS_RULE}
- Don't change anything else in the ideas repository.
- If the request is only a question, answer it and don't change files.
- ${RULES} The app commits your changes to ${cloneLabel} and pushes them.

Reply in 1-4 short sentences: what you changed (or the answer), and how to check it.`;
    return runClaude({ root, prompt, scope: { type: "folder", folder, clone, cloneLabel, cloneWritable: true }, resume: sessionId, model, rules, allowCommands, log, emit });
  }
  const prompt = `You're working on one idea in the user's daily-ideas git repository (your current working directory). The idea lives in the folder \`${folder}/\`. If you haven't seen its files in this conversation yet, read its README.md and prototype first.

The user's request:
<request>
${message}
</request>

Make the change. Rules:
- Only create or edit files inside \`${folder}/\`. Other folders are other ideas; don't touch them.
- Keep \`${folder}/README.md\` accurate. When the change affects them, update "The prototype", "Run it", "Status" and "Next steps" (tick off done items). Keep its format. ${STATUS_RULE}
- If the request is only a question, answer it and don't change files.
- ${RULES}

Reply in 1-3 short sentences: what you changed (or the answer). The user sees the updated prototype next to your reply.`;
  return runClaude({ root, prompt, scope: { type: "folder", folder }, resume: sessionId, model, rules, allowCommands, log, emit });
}

/** Import: files are already copied into `folder`; Claude writes the idea README from the code. */
export async function describeImport({ repoPath, folder, source, date, model, rules = [], allowCommands = false, log, emit = () => {} }) {
  const root = path.resolve(repoPath);
  if (FAKE()) return fakeDescribe({ root, folder, source, date, log, emit });
  const prompt = `The folder \`${folder}/\` in the user's daily-ideas git repository (your current working directory) was just imported from ${source}. It's an idea the user prototyped before they started using this app.

Write \`${folder}/README.md\` so it fits in with the other ideas:
1. Read the files in \`${folder}/\` first and base everything on the real code; don't invent features.
2. If \`${folder}/README.md\` already exists (the original project's README), first save its exact content as \`${folder}/ORIGINAL-README.md\`, then replace \`README.md\`.
3. Follow the example below: ${README_FORMAT(date)} Right after the "**Daily idea · ${date}**" line, add a line "Imported from <${source}>".
4. In "### Run it", give the real way to run this code from inside this folder.
5. ${STATUS_RULE} Judge it honestly from the code.
6. Don't change any other file. ${RULES}

Reply in 1-3 short sentences: what the idea is and the status you gave it.

Example README:
<example_readme>
${await example()}
</example_readme>`;
  return runClaude({ root, prompt, scope: { type: "folder", folder }, model, rules, allowCommands, log, emit });
}

/** Linked repo: Claude reads the clone and writes the idea README in the ideas repo. The clone isn't changed. */
export async function describeLinked({ repoPath, folder, clone, cloneLabel, date, model, rules = [], allowCommands = false, log, emit = () => {} }) {
  const root = path.resolve(repoPath);
  if (FAKE()) return fakeDescribe({ root, folder, source: cloneLabel, date, log, emit, linked: true });
  const ideaReadme = path.join(root, folder, "README.md");
  const prompt = `The user has linked their project ${cloneLabel} as one of their daily ideas. Its code is in your current working directory (a git clone). Their ideas live in a separate repository, and this idea's folder is \`${path.join(root, folder)}\`.

Write \`${ideaReadme}\` so it fits in with the other ideas:
1. Read the project's README and code first, and base everything on the real code; don't invent features.
2. Follow the example below: ${README_FORMAT(date)} Right after the "**Daily idea · ${date}**" line, add a line "Code: <${cloneLabel.startsWith("github.com") ? `https://${cloneLabel}` : cloneLabel}>".
3. "## The prototype" should say briefly where things are in the project, and "### Run it" should give the real commands to run it from a clone of the repository.
4. ${STATUS_RULE} Judge it honestly from the code.
5. If you notice something clearly broken (for example leftover merge-conflict markers), mention it under "## Next steps".
6. Write only that README. Don't change the project's files. ${RULES}

Reply in 1-3 short sentences: what the project is, the status you gave it, and anything that looked broken.

Example README:
<example_readme>
${await example()}
</example_readme>`;
  return runClaude({ root, prompt, scope: { type: "folder", folder, clone, cloneLabel, cloneWritable: false }, model, rules, allowCommands, log, emit });
}

/* ---------- test doubles: IDEA_COOKER_FAKE=1 skips Claude ---------- */

async function fakeCook({ root, idea, date, existingLower, log, emit, saveOnly, rules = [] }) {
  if (rules.length) log(`Rules: ${rules.map((r) => r.title || "untitled").join(", ")}`);
  if (saveOnly) {
    const slug = idea.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 3).join("-") || "idea";
    let folder = `${date}-${slug}`;
    for (let i = 2; existingLower.has(folder.toLowerCase()); i++) folder = `${date}-${slug}-${i}`;
    await fs.mkdir(path.join(root, folder));
    await fs.writeFile(path.join(root, folder, "README.md"), `# 💡 ${idea.slice(0, 40)}\n\n> Saved idea (test).\n\n**Daily idea · ${date}**\n\n## The idea\n\n${idea}\n\n## Status\n\n🔴 **Idea.** Not built yet.\n\n## Next steps\n\n- [ ] Build a first prototype\n`);
    log(`Write ${folder}/README.md`);
    emit({ kind: "tool", text: `Wrote ${folder}/README.md` });
    return { folder, sessionId: `fake-${folder}`, reply: `[fake] Saved “${idea.slice(0, 40)}”.` };
  }
  const slug = idea.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 3).join("-") || "idea";
  let folder = `${date}-${slug}`;
  for (let i = 2; existingLower.has(folder.toLowerCase()); i++) folder = `${date}-${slug}-${i}`;
  log(`[fake mode] writing ${folder}/ without calling Claude`);
  await fs.mkdir(path.join(root, folder));
  await fs.writeFile(
    path.join(root, folder, "README.md"),
    `# 🧪 ${idea.slice(0, 40)}\n\n> Fake idea written by the idea-cooker test mode.\n\n**Daily idea · ${date}**\n\n## The idea\n\n${idea}\n\n## Why\n\n- Testing\n\n## The prototype\n\n[\`index.html\`](index.html)\n\n### Run it\n\n\`\`\`powershell\nstart index.html\n\`\`\`\n\n## Status\n\n🟡 **Prototype.** Test content only.\n\n## Next steps\n\n- [ ] Replace with a real idea\n`,
  );
  log(`Write ${folder}/README.md`);
  emit({ kind: "tool", text: `Wrote ${folder}/README.md` });
  await fs.writeFile(path.join(root, folder, "index.html"), `<!doctype html><title>${folder}</title><h1>${folder}</h1>\n`);
  log(`Write ${folder}/index.html`);
  emit({ kind: "tool", text: `Wrote ${folder}/index.html` });
  return { folder, sessionId: `fake-${folder}`, reply: `[fake] Built a test page for “${idea.slice(0, 40)}”.` };
}

async function fakeRevise({ root, folder, message, log, emit, clone, cloneLabel }) {
  const file = clone ? path.join(clone, "CHANGES.md") : path.join(root, folder, "CHANGES.md");
  const shown = clone ? `${cloneLabel}/CHANGES.md` : `${folder}/CHANGES.md`;
  await fs.appendFile(file, `- ${message}\n`);
  log(`Write ${shown}`);
  emit({ kind: "tool", text: `Edited ${shown}` });
  return { folder, sessionId: `fake-${folder}`, reply: `[fake] Noted: ${message}` };
}

async function fakeDescribe({ root, folder, source, date, log, emit, linked = false }) {
  const readme = path.join(root, folder, "README.md");
  const old = await fs.readFile(readme, "utf8").catch(() => null);
  if (old !== null && !linked) await fs.writeFile(path.join(root, folder, "ORIGINAL-README.md"), old);
  await fs.writeFile(readme, `# 📦 ${folder}\n\n> ${linked ? "Linked" : "Imported"} test idea.\n\n**Daily idea · ${date}**\n${linked ? "Code" : "Imported from"}: <${source}>\n\n## The idea\n\nTest.\n\n## Status\n\n🟡 **Prototype.** Made by the test.\n`);
  log(`Write ${folder}/README.md`);
  emit({ kind: "tool", text: `Wrote ${folder}/README.md` });
  return { folder, sessionId: `fake-${folder}`, reply: `[fake] Imported ${folder} from ${source}.` };
}
