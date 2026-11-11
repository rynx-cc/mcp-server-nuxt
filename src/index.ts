#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CLI_VERSION, parseCliArgs, printHelp } from "./cli.js";
import { setupServer } from "./server.js";

async function main() {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv);
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
    console.error(CLI_VERSION);
    process.exit(0);
  }

  const server = new McpServer({
    name: "mcp-server-nuxt",
    version: CLI_VERSION,
  });

  await setupServer(server, parsed.projectPath, { allowWrites: parsed.allowWrites });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`MCP Nuxt Server v${CLI_VERSION} started for project: ${parsed.projectPath}`);
}

main().catch((error) => {
  console.error("MCP Nuxt Server crashed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
