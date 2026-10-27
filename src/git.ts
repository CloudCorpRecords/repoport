/**
 * repoport core: local git operations through the git CLI.
 *
 * Every operation shells out with execFile and an argument array — no
 * shell string is ever built, so paths and messages cannot break out
 * into shell syntax. Before any operation the target path must exist
 * and must sit inside a git work tree (checked with rev-parse).
 *
 * Flag-injection hardening: values that git would read as a revision
 * or ref (target, revision, branch names, base branch, contains /
 * not_contains) are rejected when they start with "-". Without that
 * check a caller could pass something like "--output=<file>" or
 * "--upload-pack=..." style flags through a supposedly data-only field.
 * File paths for git_add are passed after a "--" separator instead, so
 * ordinary paths stay safe without a dash ban.
 */
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const VERSION = "0.1.0";

const MAX_BUFFER = 10 * 1024 * 1024;

async function runGit(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", repoPath, ...args], {
      maxBuffer: MAX_BUFFER,
    });
    // Some git commands report useful detail on stderr while succeeding
    // with empty stdout (for example a checkout switching branches).
    if (stdout) return stdout;
    return stderr ?? "";
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const detail = (e.stderr || e.stdout || e.message || String(err)).trim();
    throw new Error(detail || "git command failed");
  }
}

export function rejectDash(value: string | undefined, field: string): void {
  if (value != null && String(value).trim().startsWith("-")) {
    throw new Error(`Invalid ${field}: '${value}' (values starting with '-' are rejected)`);
  }
}

export async function validateRepo(repoPath: string): Promise<string> {
  if (typeof repoPath !== "string" || !repoPath.trim()) {
    throw new Error("Invalid repo_path: expected a non-empty path");
  }
  let st;
  try {
    st = await stat(repoPath);
  } catch {
    throw new Error(`Invalid repo_path: '${repoPath}' does not exist`);
  }
  if (!st.isDirectory()) {
    throw new Error(`Invalid repo_path: '${repoPath}' is not a directory`);
  }
  try {
    await execFileAsync("git", ["-C", repoPath, "rev-parse", "--git-dir"], {
      maxBuffer: MAX_BUFFER,
    });
  } catch {
    throw new Error(`Invalid repo_path: '${repoPath}' is not a git repository`);
  }
  return repoPath;
}

function contextArg(contextLines?: number): string {
  const n = contextLines == null ? 3 : contextLines;
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid context_lines: '${contextLines}' (expected a non-negative integer)`);
  }
  return `--unified=${n}`;
}

export async function gitStatus(repoPath: string): Promise<string> {
  await validateRepo(repoPath);
  return runGit(repoPath, ["status"]);
}

export async function gitDiffUnstaged(repoPath: string, contextLines?: number): Promise<string> {
  await validateRepo(repoPath);
  return runGit(repoPath, ["diff", contextArg(contextLines)]);
}

export async function gitDiffStaged(repoPath: string, contextLines?: number): Promise<string> {
  await validateRepo(repoPath);
  return runGit(repoPath, ["diff", "--cached", contextArg(contextLines)]);
}

export async function gitDiff(
  repoPath: string,
  target: string,
  contextLines?: number,
): Promise<string> {
  await validateRepo(repoPath);
  rejectDash(target, "target");
  if (!target || !String(target).trim()) throw new Error("Invalid target: expected a non-empty value");
  return runGit(repoPath, ["diff", contextArg(contextLines), target]);
}

export async function gitAdd(repoPath: string, files: string[]): Promise<string> {
  await validateRepo(repoPath);
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("Invalid files: expected a non-empty array of paths");
  }
  const out = await runGit(repoPath, ["add", "--", ...files]);
  return out || `Staged ${files.length} file(s): ${files.join(", ")}`;
}

export async function gitReset(repoPath: string): Promise<string> {
  await validateRepo(repoPath);
  const out = await runGit(repoPath, ["reset"]);
  return out || "Reset complete: staged changes have been unstaged.";
}

export async function gitCommit(repoPath: string, message: string): Promise<string> {
  await validateRepo(repoPath);
  if (!message || !String(message).trim()) {
    throw new Error("Invalid message: expected a non-empty commit message");
  }
  return runGit(repoPath, ["commit", "-m", message]);
}

export async function gitLog(
  repoPath: string,
  maxCount?: number,
  startTimestamp?: string,
  endTimestamp?: string,
): Promise<string> {
  await validateRepo(repoPath);
  const limit = maxCount == null ? 10 : maxCount;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid max_count: '${maxCount}' (expected a positive integer)`);
  }
  const start = startTimestamp ? Date.parse(startTimestamp) : NaN;
  const end = endTimestamp ? Date.parse(endTimestamp) : NaN;
  if (startTimestamp && Number.isNaN(start)) {
    throw new Error(`Invalid start_timestamp: '${startTimestamp}' (expected an ISO timestamp)`);
  }
  if (endTimestamp && Number.isNaN(end)) {
    throw new Error(`Invalid end_timestamp: '${endTimestamp}' (expected an ISO timestamp)`);
  }

  // Fetch a generous window, apply timestamp filters in JS against the
  // author date of each commit, then cut to max_count.
  const fetchCount = startTimestamp || endTimestamp ? 1000 : limit;
  const raw = await runGit(repoPath, [
    "log",
    `--max-count=${fetchCount}`,
    "--pretty=format:%H%x09%aI%x09%s%x09%an",
  ]);
  if (!raw.trim()) return "";
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const kept: string[] = [];
  for (const line of lines) {
    const parts = line.split("\t");
    const dateStr = parts[1] ?? "";
    const t = Date.parse(dateStr);
    if (!Number.isNaN(start) && !Number.isNaN(t) && t < start) continue;
    if (!Number.isNaN(end) && !Number.isNaN(t) && t > end) continue;
    const hash = parts[0] ?? "";
    const subject = parts[2] ?? "";
    const author = parts[3] ?? "";
    kept.push(`${hash} ${dateStr} ${subject}${author ? ` (${author})` : ""}`);
    if (kept.length >= limit) break;
  }
  return kept.join("\n") + (kept.length ? "\n" : "");
}

export async function gitShow(repoPath: string, revision: string): Promise<string> {
  await validateRepo(repoPath);
  rejectDash(revision, "revision");
  if (!revision || !String(revision).trim()) {
    throw new Error("Invalid revision: expected a non-empty value");
  }
  return runGit(repoPath, ["show", revision]);
}

export async function gitCreateBranch(
  repoPath: string,
  branchName: string,
  baseBranch?: string,
): Promise<string> {
  await validateRepo(repoPath);
  rejectDash(branchName, "branch_name");
  rejectDash(baseBranch, "base_branch");
  if (!branchName || !String(branchName).trim()) {
    throw new Error("Invalid branch_name: expected a non-empty value");
  }
  const args = ["branch", branchName];
  if (baseBranch) args.push(baseBranch);
  const out = await runGit(repoPath, args);
  return out || `Created branch '${branchName}'${baseBranch ? ` from '${baseBranch}'` : ""}.`;
}

export async function gitCheckout(repoPath: string, branchName: string): Promise<string> {
  await validateRepo(repoPath);
  rejectDash(branchName, "branch_name");
  if (!branchName || !String(branchName).trim()) {
    throw new Error("Invalid branch_name: expected a non-empty value");
  }
  const out = await runGit(repoPath, ["checkout", branchName]);
  return out || `Switched to branch '${branchName}'.`;
}

export async function gitBranch(
  repoPath: string,
  branchType?: string,
  contains?: string,
  notContains?: string,
): Promise<string> {
  await validateRepo(repoPath);
  const type = branchType ?? "local";
  if (!["local", "remote", "all"].includes(type)) {
    throw new Error(`Invalid branch_type: '${branchType}' (expected local, remote or all)`);
  }
  rejectDash(contains, "contains");
  rejectDash(notContains, "not_contains");
  const args: string[] = ["branch"];
  if (type === "remote") args.push("-r");
  if (type === "all") args.push("-a");
  if (contains) args.push("--contains", contains);
  if (notContains) args.push("--no-contains", notContains);
  return runGit(repoPath, args);
}
