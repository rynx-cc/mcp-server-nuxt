/**
 * Layer tools: inspect_layers.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';

export function registerLayerTools(server: McpServer, ctx: NuxtProjectContext): void {
  server.tool(
    'inspect_layers',
    'Resolve and return the full Nuxt extends hierarchy (layers). Returns layers ordered by override priority (project first), with each layer\'s config file, raw extends, and sub-layers.',
    safe(async () => {
      const layers = await ctx.layers();
      return jsonResult({ count: layers.length, layers });
    }),
  );
}
