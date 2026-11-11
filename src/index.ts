#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseCliArgs } from "./cli.js";
import { setupServer } from "./server.js";

let projectPath: string;
let allowWrites: boolean;
try {
  ({ projectPath, allowWrites } = parseCliArgs(process.argv));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function main() {
  const server = new McpServer({
    name: "mcp-server-nuxt",
    version: "0.2.0",
  });

  await setupServer(server, projectPath, { allowWrites });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stderr keeps stdout clean for the MCP JSON-RPC protocol.
  console.error(`MCP Nuxt Server started for project: ${projectPath}`);
}

main().catch((error) => {
  console.error("MCP Nuxt Server crashed:", error);
  process.exit(1);
});
