import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { setupServer } from "./server.js";

const projectPath = resolve(process.cwd(), process.argv[2] || "."); // Default to current directory if no path provided

async function main() {
  const server = new McpServer({
    name: "mcp-server-nuxt",
    version: "0.1.0",
  });

  await setupServer(server, projectPath);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stderr keeps stdout clean for the MCP JSON-RPC protocol.
  console.error(`MCP Nuxt Server started for project: ${projectPath}`);
}

main().catch((error) => {
  console.error("MCP Nuxt Server crashed:", error);
  process.exit(1);
});
