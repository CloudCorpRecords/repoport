/**
 * repoport MCP server. Twelve git tools over the local git CLI.
 *
 * Why the low-level Server instead of McpServer: the high-level helper
 * converts zod schemas to JSON Schema and injects keys that are not in
 * this tool's public spec ("$schema" and "additionalProperties"), which
 * breaks exact tool-list/schema parity. This file therefore serves
 * tools/list with the spec's exact input schemas, while zod still
 * validates every tools/call argument set.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
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
  VERSION,
} from "./git.js";

const RepoOnly = z.object({ repo_path: z.string() });
const DiffOnly = z.object({ repo_path: z.string(), context_lines: z.number().int().optional() });
const DiffTarget = z.object({
  repo_path: z.string(),
  target: z.string(),
  context_lines: z.number().int().optional(),
});
const AddArgs = z.object({ repo_path: z.string(), files: z.array(z.string()) });
const CommitArgs = z.object({ repo_path: z.string(), message: z.string() });
const LogArgs = z.object({
  repo_path: z.string(),
  max_count: z.number().int().optional(),
  start_timestamp: z.string().optional(),
  end_timestamp: z.string().optional(),
});
const ShowArgs = z.object({ repo_path: z.string(), revision: z.string() });
const CreateBranchArgs = z.object({
  repo_path: z.string(),
  branch_name: z.string(),
  base_branch: z.string().optional(),
});
const CheckoutArgs = z.object({ repo_path: z.string(), branch_name: z.string() });
const BranchArgs = z.object({
  repo_path: z.string(),
  branch_type: z.string().optional(),
  contains: z.string().optional(),
  not_contains: z.string().optional(),
});

const TOOLS = [
  {
    name: "git_status",
    description: "Show the working tree status of a repository.",
    inputSchema: {
      type: "object" as const,
      properties: { repo_path: { description: "Path of the local git repository.", type: "string" } },
      required: ["repo_path"],
    },
  },
  {
    name: "git_diff_unstaged",
    description: "Show unstaged changes in the working tree.",
    inputSchema: {
      type: "object" as const,
      properties: {
        repo_path: { description: "Path of the local git repository.", type: "string" },
        context_lines: { description: "Number of context lines to include around each change.", type: "integer" },
      },
      required: ["repo_path"],
    },
  },
  {
    name: "git_diff_staged",
    description: "Show changes staged for the next commit.",
    inputSchema: {
      type: "object" as const,
      properties: {
        repo_path: { description: "Path of the local git repository.", type: "string" },
        context_lines: { description: "Number of context lines to include around each change.", type: "integer" },
      },
      required: ["repo_path"],
    },
  },
  {
    name: "git_diff",
    description: "Show changes between the working tree and a target revision.",
    inputSchema: {
      type: "object" as const,
      properties: {
        repo_path: { description: "Path of the local git repository.", type: "string" },
        target: { description: "Target revision to compare the working tree against.", type: "string" },
        context_lines: { description: "Number of context lines to include around each change.", type: "integer" },
      },
      required: ["repo_path", "target"],
    },
  },
  {
    name: "git_add",
    description: "Stage files for the next commit.",
    inputSchema: {
      type: "object" as const,
      properties: {
        repo_path: { description: "Path of the local git repository.", type: "string" },
        files: { description: "Files to stage, as paths relative to the repository.", type: "array", items: { type: "string" } },
      },
      required: ["repo_path", "files"],
    },
  },
  {
    name: "git_reset",
    description: "Unstage all staged changes, keeping the working tree.",
    inputSchema: {
      type: "object" as const,
      properties: { repo_path: { description: "Path of the local git repository.", type: "string" } },
      required: ["repo_path"],
    },
  },
  {
    name: "git_commit",
    description: "Commit staged changes with a message.",
    inputSchema: {
      type: "object" as const,
      properties: {
        repo_path: { description: "Path of the local git repository.", type: "string" },
        message: { description: "Commit message for the staged changes.", type: "string" },
      },
      required: ["repo_path", "message"],
    },
  },
  {
    name: "git_log",
    description: "List recent commits, optionally within a timestamp window.",
    inputSchema: {
      type: "object" as const,
      properties: {
        repo_path: { description: "Path of the local git repository.", type: "string" },
        max_count: { description: "Maximum number of commits to return.", type: "integer" },
        start_timestamp: { description: "Only return commits at or after this timestamp.", type: "string" },
        end_timestamp: { description: "Only return commits at or before this timestamp.", type: "string" },
      },
      required: ["repo_path"],
    },
  },
  {
    name: "git_show",
    description: "Show a commit or other revision object.",
    inputSchema: {
      type: "object" as const,
      properties: {
        repo_path: { description: "Path of the local git repository.", type: "string" },
        revision: { description: "Revision to show, such as a commit hash or a tag.", type: "string" },
      },
      required: ["repo_path", "revision"],
    },
  },
  {
    name: "git_create_branch",
    description: "Create a new branch, optionally from a base branch.",
    inputSchema: {
      type: "object" as const,
      properties: {
        repo_path: { description: "Path of the local git repository.", type: "string" },
        branch_name: { description: "Name of the branch to create.", type: "string" },
        base_branch: { description: "Optional branch to create the new branch from.", type: "string" },
      },
      required: ["repo_path", "branch_name"],
    },
  },
  {
    name: "git_checkout",
    description: "Switch to an existing branch.",
    inputSchema: {
      type: "object" as const,
      properties: {
        repo_path: { description: "Path of the local git repository.", type: "string" },
        branch_name: { description: "Name of the existing branch to switch to.", type: "string" },
      },
      required: ["repo_path", "branch_name"],
    },
  },
  {
    name: "git_branch",
    description: "List branches, optionally filtered by containment.",
    inputSchema: {
      type: "object" as const,
      properties: {
        repo_path: { description: "Path of the local git repository.", type: "string" },
        branch_type: { description: "Which branches to list: local, remote, or all.", type: "string" },
        contains: { description: "Only list branches that contain this commit.", type: "string" },
        not_contains: { description: "Only list branches that do not contain this commit.", type: "string" },
      },
      required: ["repo_path"],
    },
  },
];

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "repoport", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case "git_status": {
        const p = RepoOnly.parse(args ?? {});
        return textResult(await gitStatus(p.repo_path));
      }
      case "git_diff_unstaged": {
        const p = DiffOnly.parse(args ?? {});
        return textResult(await gitDiffUnstaged(p.repo_path, p.context_lines));
      }
      case "git_diff_staged": {
        const p = DiffOnly.parse(args ?? {});
        return textResult(await gitDiffStaged(p.repo_path, p.context_lines));
      }
      case "git_diff": {
        const p = DiffTarget.parse(args ?? {});
        return textResult(await gitDiff(p.repo_path, p.target, p.context_lines));
      }
      case "git_add": {
        const p = AddArgs.parse(args ?? {});
        return textResult(await gitAdd(p.repo_path, p.files));
      }
      case "git_reset": {
        const p = RepoOnly.parse(args ?? {});
        return textResult(await gitReset(p.repo_path));
      }
      case "git_commit": {
        const p = CommitArgs.parse(args ?? {});
        return textResult(await gitCommit(p.repo_path, p.message));
      }
      case "git_log": {
        const p = LogArgs.parse(args ?? {});
        return textResult(
          await gitLog(p.repo_path, p.max_count, p.start_timestamp, p.end_timestamp),
        );
      }
      case "git_show": {
        const p = ShowArgs.parse(args ?? {});
        return textResult(await gitShow(p.repo_path, p.revision));
      }
      case "git_create_branch": {
        const p = CreateBranchArgs.parse(args ?? {});
        return textResult(await gitCreateBranch(p.repo_path, p.branch_name, p.base_branch));
      }
      case "git_checkout": {
        const p = CheckoutArgs.parse(args ?? {});
        return textResult(await gitCheckout(p.repo_path, p.branch_name));
      }
      case "git_branch": {
        const p = BranchArgs.parse(args ?? {});
        return textResult(
          await gitBranch(p.repo_path, p.branch_type, p.contains, p.not_contains),
        );
      }
    }
  } catch (err) {
    return errorResult(err);
  }
  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
