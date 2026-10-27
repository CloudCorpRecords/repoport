# repoport

repoport gives an agent hands on a local git repository without giving
it a shell. It covers the everyday loop — check status, read diffs,
stage files, commit, read the log, inspect a revision, and move between
branches — and it does so by calling the git CLI directly, with every
argument passed as data rather than stitched into a shell string.

The repository path is checked before anything runs: it must exist and
must be inside a git work tree. Revision-like values that begin with a
dash are refused, so a branch name or revision cannot smuggle an extra
git flag into a call.

## Install

```bash
npx @reneturcios/repoport status .
```

Or run the container image:

```bash
docker run -i ghcr.io/cloudcorprecords/repoport
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead. The image and the npm package
both expect a `git` binary and access to the repository you point at;
mount or run against a local checkout accordingly.

## CLI

```bash
# Working tree status for a repository
repoport status ~/src/my-project

# Recent commits (default 10, pass a count to change it)
repoport log ~/src/my-project
repoport log ~/src/my-project 25

repoport --version
```

Exit codes: `0` on success, `1` when git or the repository check fails
(the error carries git's own message), `2` for usage errors.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/repoport mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "repoport": {
      "command": "npx",
      "args": ["-y", "@reneturcios/repoport", "mcp"]
    }
  }
}
```

### Tools

| Tool | Input | What it returns |
| --- | --- | --- |
| `git_status` | `repo_path` (required) | The long-form `git status` output for the repository. |
| `git_diff_unstaged` | `repo_path` (required), `context_lines` (optional, default 3) | A unified diff of unstaged working-tree changes. |
| `git_diff_staged` | `repo_path` (required), `context_lines` (optional, default 3) | A unified diff of changes staged for the next commit. |
| `git_diff` | `repo_path`, `target` (both required), `context_lines` (optional) | A unified diff against the given target revision. |
| `git_add` | `repo_path`, `files` (array of strings, both required) | Stages the named files; paths are passed after `--`. |
| `git_reset` | `repo_path` (required) | Unstages everything (`git reset`), leaving working-tree edits in place. |
| `git_commit` | `repo_path`, `message` (both required) | Commits whatever is currently staged with the given message. |
| `git_log` | `repo_path` (required), `max_count` (optional, default 10), `start_timestamp`, `end_timestamp` (optional ISO strings) | Recent commits newest first; timestamp bounds are applied against each commit's author date. |
| `git_show` | `repo_path`, `revision` (both required) | The `git show` output for that revision. |
| `git_create_branch` | `repo_path`, `branch_name` (both required), `base_branch` (optional) | Creates a branch without switching to it. |
| `git_checkout` | `repo_path`, `branch_name` (both required) | Switches the work tree to the named branch. |
| `git_branch` | `repo_path` (required), `branch_type` (optional: `local`, `remote` or `all`, default `local`), `contains`, `not_contains` (optional) | Branch listing, optionally filtered to branches that contain or do not contain a commit. |

Every tool returns git's stdout as its text result. Failures — a
missing path, a path that is not a repository, a git error, or a
rejected dash-prefixed value — come back as tool errors carrying the
underlying message.

### Safety notes

- No shell is involved anywhere: arguments travel as an `execFile`
  argument array.
- `branch_name`, `target`, `revision`, `contains` and `not_contains`
  values starting with `-` are rejected before git ever sees them.
- `git_commit` only commits what is already staged; it never stages
  on your behalf.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network
npm run dev     # run the CLI from source via tsx
```

Tests build a throwaway repository in a temp directory (initialising
git and setting a local test identity there) and exercise the full
loop against it, so they need a `git` binary on `PATH` but no network
and no pre-existing checkout.

## License

MIT — see `LICENSE`.
