/**
 * repoport types.
 *
 * Every tool takes a repository path plus tool-specific arguments and
 * returns the git command's output as text. These interfaces mirror the
 * public tool spec shapes so the core, CLI and MCP layers agree.
 */

export interface RepoArgs {
  repo_path: string;
}

export interface DiffArgs extends RepoArgs {
  context_lines?: number;
}

export interface TargetDiffArgs extends RepoArgs {
  target: string;
  context_lines?: number;
}

export interface AddArgs extends RepoArgs {
  files: string[];
}

export interface CommitArgs extends RepoArgs {
  message: string;
}

export interface LogArgs extends RepoArgs {
  max_count?: number;
  start_timestamp?: string;
  end_timestamp?: string;
}

export interface ShowArgs extends RepoArgs {
  revision: string;
}

export interface CreateBranchArgs extends RepoArgs {
  branch_name: string;
  base_branch?: string;
}

export interface CheckoutArgs extends RepoArgs {
  branch_name: string;
}

export type BranchType = "local" | "remote" | "all";

export interface BranchArgs extends RepoArgs {
  branch_type?: string;
  contains?: string;
  not_contains?: string;
}
