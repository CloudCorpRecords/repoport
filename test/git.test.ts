import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  gitAdd,
  gitBranch,
  gitCheckout,
  gitCommit,
  gitCreateBranch,
  gitDiff,
  gitDiffStaged,
  gitDiffUnstaged,
  gitLog,
  gitReset,
  gitShow,
  gitStatus,
} from "../src/git.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
  return stdout;
}

describe("repoport git operations", () => {
  let repo: string;

  before(async () => {
    repo = await mkdtemp(join(tmpdir(), "repoport-test-"));
    await execFileAsync("git", ["init", repo]);
    await git(repo, ["config", "user.email", "test@example.com"]);
    await git(repo, ["config", "user.name", "Repoport Test"]);
    await git(repo, ["config", "commit.gpgsign", "false"]);
  });

  after(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it("status is clean on a fresh repo with a committed file", async () => {
    await writeFile(join(repo, "a.txt"), "hello\n");
    await gitAdd(repo, ["a.txt"]);
    await gitCommit(repo, "initial commit");
    const status = await gitStatus(repo);
    assert.match(status, /clean|nothing to commit/);
  });

  it("status shows dirty / untracked files", async () => {
    await writeFile(join(repo, "b.txt"), "new file\n");
    const status = await gitStatus(repo);
    assert.match(status, /b\.txt/);
  });

  it("add stages a file and staged diff shows it", async () => {
    await gitAdd(repo, ["b.txt"]);
    const staged = await gitDiffStaged(repo);
    assert.match(staged, /b\.txt/);
    assert.match(staged, /new file/);
    await gitCommit(repo, "add b");
  });

  it("commit + log respects max_count", async () => {
    await writeFile(join(repo, "c.txt"), "third\n");
    await gitAdd(repo, ["c.txt"]);
    await gitCommit(repo, "add c");
    const logAll = await gitLog(repo, 10);
    assert.match(logAll, /initial commit/);
    assert.match(logAll, /add b/);
    assert.match(logAll, /add c/);
    const logOne = await gitLog(repo, 1);
    const lines = logOne.trim().split("\n");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /add c/);
  });

  it("log timestamp filter excludes old commits", async () => {
    const future = await gitLog(repo, 10, "2999-01-01T00:00:00Z");
    assert.equal(future.trim(), "");
    const past = await gitLog(repo, 10, "2000-01-01T00:00:00Z", "2999-01-01T00:00:00Z");
    assert.match(past, /initial commit/);
    const ended = await gitLog(repo, 10, undefined, "2000-01-01T00:00:00Z");
    assert.equal(ended.trim(), "");
  });

  it("unstaged diff appears after modifying a tracked file", async () => {
    await writeFile(join(repo, "a.txt"), "hello\nchanged line\n");
    const diff = await gitDiffUnstaged(repo);
    assert.match(diff, /changed line/);
    // Restore for later tests
    await execFileAsync("git", ["-C", repo, "checkout", "--", "a.txt"]);
  });

  it("git_diff against HEAD~1 shows the last commit's change", async () => {
    const diff = await gitDiff(repo, "HEAD~1");
    assert.match(diff, /c\.txt|third/);
  });

  it("create_branch + checkout + git_branch listing and contains filter", async () => {
    await gitCreateBranch(repo, "feature-x");
    const branches = await gitBranch(repo, "local");
    assert.match(branches, /feature-x/);
    const containing = await gitBranch(repo, "local", "HEAD");
    assert.match(containing, /feature-x/);
    await gitCheckout(repo, "feature-x");
    const status = await gitStatus(repo);
    assert.match(status, /feature-x|On branch/);
    // Return to the default branch for subsequent tests
    const defaultBranch = (await git(repo, ["branch", "--show-current"])).trim();
    assert.equal(defaultBranch, "feature-x");
    const all = await gitBranch(repo, "all");
    assert.match(all, /feature-x/);
    // Switch back to the initial branch (master or main)
    const locals = await gitBranch(repo, "local");
    const other = locals
      .split("\n")
      .map((l) => l.replace(/^[* ]+/, "").trim())
      .find((b) => b && b !== "feature-x");
    assert.ok(other, "expected another local branch");
    await gitCheckout(repo, other!);
  });

  it("show HEAD returns the latest commit", async () => {
    const shown = await gitShow(repo, "HEAD");
    assert.match(shown, /add c|commit/);
  });

  it("reset unstages staged changes", async () => {
    await writeFile(join(repo, "d.txt"), "staged then reset\n");
    await gitAdd(repo, ["d.txt"]);
    const stagedBefore = await gitDiffStaged(repo);
    assert.match(stagedBefore, /d\.txt/);
    await gitReset(repo);
    const stagedAfter = await gitDiffStaged(repo);
    assert.equal(stagedAfter.trim(), "");
    const status = await gitStatus(repo);
    assert.match(status, /d\.txt/);
    await rm(join(repo, "d.txt"), { force: true });
  });

  it("rejects an invalid repo_path", async () => {
    await assert.rejects(() => gitStatus("/nonexistent/repoport-no-such-dir"), /does not exist|not a git/);
    await assert.rejects(() => gitStatus(repo + "/a.txt"), /not a directory|not a git/);
  });

  it("rejects dash-prefixed branch / revision values", async () => {
    await assert.rejects(() => gitCreateBranch(repo, "-evil"), /starting with '-'/);
    await assert.rejects(() => gitCheckout(repo, "--upload-pack=touch"), /starting with '-'/);
    await assert.rejects(() => gitShow(repo, "-p"), /starting with '-'/);
    await assert.rejects(() => gitDiff(repo, "--output=/tmp/x"), /starting with '-'/);
    await assert.rejects(() => gitBranch(repo, "local", "-x"), /starting with '-'/);
  });

  it("rejects an invalid branch_type", async () => {
    await assert.rejects(() => gitBranch(repo, "weird"), /branch_type/);
  });
});
