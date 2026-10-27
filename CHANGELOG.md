# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `repoport status <repo>` prints a repository status summary and
  `repoport log <repo> [max_count]` prints recent commits; `repoport mcp`
  starts the stdio MCP server.
- MCP server with twelve tools: `git_status`, `git_diff_unstaged`,
  `git_diff_staged`, `git_diff`, `git_add`, `git_reset`, `git_commit`,
  `git_log`, `git_show`, `git_create_branch`, `git_checkout`, `git_branch`.
- All operations shell out to the git CLI with argument arrays, validate
  the repository before running, and reject revision-like values that
  start with a dash.
