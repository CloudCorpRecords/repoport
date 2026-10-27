#!/usr/bin/env node
/**
 * repoport CLI.
 *
 *   repoport mcp
 *   repoport status <repo>
 *   repoport log <repo> [max_count]
 *   repoport --version
 *
 * Exit codes: 0 success, 1 git/lookup error, 2 usage error.
 */
import { gitLog, gitStatus, VERSION } from "./git.js";

function usage(): never {
  console.error(`Usage:
  repoport status <repo>
  repoport log <repo> [max_count]
  repoport mcp
  repoport --version`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  try {
    if (cmd === "status") {
      const [repo] = rest;
      if (!repo) usage();
      const out = await gitStatus(repo);
      process.stdout.write(out.endsWith("\n") || out === "" ? out : out + "\n");
    } else if (cmd === "log") {
      const [repo, maxRaw] = rest;
      if (!repo) usage();
      let maxCount: number | undefined;
      if (maxRaw !== undefined) {
        maxCount = Number(maxRaw);
        if (!Number.isInteger(maxCount) || maxCount < 1) usage();
      }
      const out = await gitLog(repo, maxCount);
      process.stdout.write(out.endsWith("\n") || out === "" ? out : out + "\n");
    } else {
      usage();
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
