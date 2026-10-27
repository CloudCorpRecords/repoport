# repoport — Build Report

Wave 1, Batch 2, MCP Rebuild 100. Clean-room rebuild of the "git" MCP
server (mcp-server-git), built from the public tool spec in
`harness/fixtures/git-tools-original.json` only. Local build only —
nothing pushed or published.

Identity: repo `repoport`, npm `@reneturcios/repoport`,
MCP name `io.github.CloudCorpRecords/repoport`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `repoport: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Local git operations over MCP: status,
  diff, log, branches and commits." = **71 chars** (≤100 ✓); npm entry
  carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/repoport:0.1.0` carries **no** `version`
  field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/repoport"`
- `tsconfig.json` (copied from clockport's, which is byte-identical to
  shipcheck's), `.gitignore`, `LICENSE` (MIT, Copyright (c) 2026
  Rene Turcios), `README.md` (fresh text), `CHANGELOG.md` (single
  0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (`mcp`, `status <repo>`,
  `log <repo> [max_count]`, `--version`; exit 2 usage / 1 git error),
  `src/mcp.ts`, `src/types.ts`, `src/git.ts` (core logic,
  `VERSION = "0.1.0"`)
- `test/git.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (adapted from clockport's; image `ghcr.io/cloudcorprecords/repoport`
  and smoke-test server name changed)

## Implementation notes

- Core shells out to the git CLI via `child_process` `execFile` with
  argument arrays only — no shell string is ever constructed.
  `src/git.ts` exports one async function per tool, each returning
  git's stdout as text.
- Every operation first validates `repo_path`: the path must exist,
  must be a directory, and `git -C <path> rev-parse --git-dir` must
  succeed, otherwise the call fails with an "Invalid repo_path" error.
- Flag-injection hardening (documented in `src/git.ts` and the README):
  `branch_name`, `base_branch`, `target`, `revision`, `contains` and
  `not_contains` values starting with `-` are rejected before git sees
  them. `git_add` file paths are passed after a `--` separator instead.
- `context_lines` defaults to 3 and is passed as `--unified=<n>`.
- `git_log` runs `git log --max-count=<n>` (default 10) with a format
  carrying the author date; when `start_timestamp` / `end_timestamp`
  are given it fetches a wider window (1000), filters in JS against
  each commit's parsed author date, then cuts to `max_count`.
- `git_branch`: `branch_type` is one of `local` / `remote` / `all`
  (default `local`, anything else is an error); `contains` /
  `not_contains` are forwarded as git's `--contains` / `--no-contains`
  arguments after the dash check.
- `git_commit` runs `git commit -m <message>` only — it commits what
  is staged and never stages on the caller's behalf.
- **Low-level Server API, per the standing Wave 1 rule:** `src/mcp.ts`
  registers tools via `Server` from
  `@modelcontextprotocol/sdk/server/index.js` with explicit
  `inputSchema` literals exactly as spec'd (no per-property
  descriptions, `integer` for counts/context). `McpServer` + zod
  registration is not used (it injects `$schema` /
  `additionalProperties` and caps parity at 50%); zod still validates
  every `tools/call` argument set internally.

## Verification (exact outputs)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo tsc_exit=$?
tsc_exit=0
```
`dist/` produced (cli.js, git.js, mcp.js, index.js, types.js, plus
.d.ts/.js.map).

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 13
ℹ pass 13
ℹ fail 0
```
The suite creates a temp git repository itself (`git init`, local
`user.email` / `user.name` config, files written with node fs) and
covers: status clean and status dirty, add + staged diff, commit +
log (max_count and timestamp filters in both directions), unstaged
diff after a modify, `git_diff` against `HEAD~1`, create_branch +
checkout + git_branch listing (local, all, contains filter), show
HEAD, reset unstaging a staged file, invalid repo_path errors (missing
path and a file path), dash-prefixed branch / checkout / revision /
target / contains rejection, and invalid branch_type rejection.

### 3. CLI smoke
`node dist/cli.js --version` -> `0.1.0` (exit 0); no args and an
unknown command print Usage and exit 2; `status /tmp` exits 1 with
`error: Invalid repo_path: '/tmp' is not a git repository`.

### 4. Parity (harness)
Original is tools-file mode, so the harness records
`fixture_results: SKIPPED-TOOLS-FILE-MODE` — expected semantics, not
an error:
```
$ python3 ~/workspace/mcp-rebuild-100/harness/parity.py \
    --original ~/workspace/mcp-rebuild-100/harness/fixtures/git-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/repoport/dist/cli.js mcp" \
    --out ~/workspace/mcp-rebuild-100/builds/repoport/parity-out
verdict=PASS parity_pct=100.0 original_tools=12 rebuild_tools=12 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
`parity-out/parity.json` on disk confirms: `verdict: PASS`,
`parity_pct: 100.0`, `identical_tools: 12`, `matched_tools: 12`,
`missing_tools: []`, `extra_tools: []`, `schema_diffs: {}`.

## Lockfile status

copied from shipcheck with identity fields edited; clean lockfile
regen required before publish. Concretely: `package-lock.json` was
copied from shipcheck's and edited with the file edit tool —
top-level `name`, root package `name`, and the root package `bin` key
changed `shipcheck` -> `repoport` (dependency ranges are identical,
so the tree is unchanged). Per the fleet lesson in TEMPLATE.md §2
item 6, a lockfile must be generated clean (no `node_modules`
present) before first publish — **clean regeneration is deferred to
the publish wave**; do not publish from this lockfile as-is.
`node_modules` in this build dir is a `cp -a` copy of shipcheck's
(local build only, gitignored; the copy emitted ownership-preservation
warnings only, and `tsc` / `tsx` run correctly from it).

## Blockers / honest gaps

None for the local build. Notes:

- Live original parity was not run: the reference Python server cannot
  launch in this VM (documented in SCOREBOARD.md), so parity is
  against the audited ground-truth fixture, as with the Wave 1 builds.
- `git_branch` remote listing (`branch_type: remote` / `all` against
  real remotes) is implemented via git's own `-r` / `-a` flags but the
  test repository has no remotes, so only local and `all` (which then
  equals local) are exercised by the suite.
- Container build not exercised locally (no Docker run in this wave);
  the publish-container workflow smoke-tests the image at publish
  time. Note the runtime image is `node:20-alpine`, which does not
  bundle a `git` binary — the container smoke test only exercises
  `initialize` and CLI usage, not a real git operation. Worth a look
  in the publish wave if containerised git operations are required.
- mcpaudit / mcpvet / shipcheck pre-publish gates not run — they
  belong to the pre-publish gate, as with the Wave 1 builds.

## Publish-gate remediation (2026-10-27)

Recorded under Rene's 2026-10-27 decision ("Remediate the 6: add param
descriptions + capability-class vet policy, then re-gate") and
`publish/GATE-POLICY.md`. This is an authorized deviation from the
parity-faithful state: descriptions were added to every tool parameter
that lacked one, in the `src/mcp.ts` schema literals only — parameter
names, types, required lists and enums are unchanged.

- Descriptions added: 28 (all 28 served parameters now described).
- Rebuild: `npm run build` (tsc) exit 0; `tsc --noEmit` exit 0; full
  test suite 13/13 pass.
- Parity harness re-run, verbatim: **PARTIAL, parity_pct 50.0** — all
  28 schema diffs are description additions (0 structural). Structural
  parity proven independently: stripping `description` keys from the
  post-remediation tools/list deep-equals the pre-remediation
  tools/list. Adjudication: the description-only diffs are the
  authorized remediation itself; structural parity is unchanged.
  Full record: `publish/parity-remediation/repoport/parity.json`.
- Re-gate: mcpaudit **PASS 100/100 grade A** (raw:
  `publish/regate/repoport-mcpaudit.json`); mcpvet raw **REVIEW,
  risk 25** (raw: `publish/regate/repoport-mcpvet.json`), findings
  adjudicated under GATE-POLICY.md — see PUBLISH-WAVES.md.
