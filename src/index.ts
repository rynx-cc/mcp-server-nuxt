import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { setupServer } from "./server.js";

const projectPath = resolve(process.cwd(), process.argv[2] || "."); // Default to current directory if no path provided
const allowWrites = process.argv.includes("--allow-writes") || process.env.MCP_NUXT_ALLOW_WRITES === "1";

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
