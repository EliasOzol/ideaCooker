import { execFile } from "node:child_process";

/** Run git in `cwd`; resolves { code, stdout, stderr } and never throws on a non-zero exit. */
export function git(cwd, args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function mustGit(cwd, args) {
  const r = await git(cwd, args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

/** Facts about a candidate repo, shown to the user before they confirm it. */
export async function inspectRepo(repoPath) {
  const top = await git(repoPath, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { ok: false, error: "Not a git repository (git rev-parse failed)." };
  const branch = (await git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout;
  const remote = (await git(repoPath, ["remote", "get-url", "origin"])).stdout || null;
  const upstream = await git(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const dirty = (await git(repoPath, ["status", "--porcelain"])).stdout;
  return {
    ok: true,
    toplevel: top.stdout,
    branch,
    remote,
    upstream: upstream.code === 0 ? upstream.stdout : null,
    dirtyFiles: dirty ? dirty.split("\n").length : 0,
  };
}

/** Fast-forward from the remote before writing, so the push afterwards doesn't get rejected. */
export async function pullIfRemote(repoPath, log) {
  const info = await inspectRepo(repoPath);
  if (!info.remote || !info.upstream) {
    log(`No upstream branch, skipping pull.`);
    return;
  }
  log(`git pull --ff-only (${info.upstream})`);
  await mustGit(repoPath, ["pull", "--ff-only"]);
}

/** Commit only `paths` (folder names relative to the repo) and optionally push. */
export async function commitAndPush(repoPath, paths, message, { push, log }) {
  // -A also stages deletions, so removing an idea's folder commits like any other change.
  await mustGit(repoPath, ["add", "-A", "--", ...paths]);
  const staged = await git(repoPath, ["diff", "--cached", "--quiet", "--", ...paths]);
  if (staged.code === 0) {
    log("Nothing to commit.");
    return { committed: false, pushed: false };
  }
  await mustGit(repoPath, ["commit", "-m", message, "--", ...paths]);
  const sha = await mustGit(repoPath, ["rev-parse", "--short", "HEAD"]);
  log(`Committed ${sha}: ${message.split("\n")[0]}`);
  if (!push) {
    log("Push is turned off in settings; commit stays local.");
    return { committed: true, pushed: false, sha };
  }
  const info = await inspectRepo(repoPath);
  if (!info.remote) {
    log("No 'origin' remote; commit stays local.");
    return { committed: true, pushed: false, sha };
  }
  const args = info.upstream ? ["push"] : ["push", "-u", "origin", "HEAD"];
  log(`git ${args.join(" ")}`);
  await mustGit(repoPath, args);
  log("Pushed.");
  return { committed: true, pushed: true, sha };
}
