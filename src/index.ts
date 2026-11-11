#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { setupServer } from "./server.js";

const VERSION = "0.3.0";

function printHelp(): void {
  const text = `mcp-server-nuxt v${VERSION}

Usage:
  mcp-server-nuxt [options] [project-path]
  mcp-server-nuxt --project <path> [options]

A Model Context Protocol server that exposes Nuxt's resolved project state
to AI agents over stdio.

Options:
  -p, --project <path>   Nuxt project root (default: cwd)
      --allow-writes     Enable mutating tools to write to disk
  -h, --help             Show this help
  -V, --version          Show version

Environment:
  MCP_NUXT_ALLOW_WRITES=1   Same as --allow-writes

Examples:
  npx mcp-server-nuxt /absolute/path/to/nuxt/app
  mcp-server-nuxt --project ./apps/web --allow-writes
`;
  // Help goes to stderr so stdout stays clean for MCP JSON-RPC when piped.
  console.error(text);
}

function parseArgs(argv: string[]): {
  projectPath: string;
  allowWrites: boolean;
  help: boolean;
  version: boolean;
} {
  let projectPath: string | undefined;
  let allowWrites = process.env.MCP_NUXT_ALLOW_WRITES === "1";
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--version" || arg === "-V") {
      version = true;
      continue;
    }
    if (arg === "--allow-writes") {
      allowWrites = true;
      continue;
    }
    if (arg === "--project" || arg === "-p") {
      const next = argv[++i];
      if (!next) throw new Error("--project requires a path argument");
      projectPath = next;
      continue;
    }
    if (arg.startsWith("--project=")) {
      projectPath = arg.slice("--project=".length);
      continue;
    }
    if (!arg.startsWith("-") && projectPath === undefined) {
      projectPath = arg;
      continue;
    }
  }

  return {
    projectPath: resolve(process.cwd(), projectPath || "."),
    allowWrites,
    help,
    version,
  };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }

  if (parsed.help) {
    printHelp();
    process.exit(0);
  }
  if (parsed.version) {
    console.error(VERSION);
    process.exit(0);
  }

  const server = new McpServer({
    name: "mcp-server-nuxt",
    version: VERSION,
  });

  await setupServer(server, parsed.projectPath, { allowWrites: parsed.allowWrites });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`MCP Nuxt Server v${VERSION} started for project: ${parsed.projectPath}`);
}

main().catch((error) => {
  console.error("MCP Nuxt Server crashed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
