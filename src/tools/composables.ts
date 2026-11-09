/**
 * Composable tools: list_composables.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';

export function registerComposableTools(server: McpServer, ctx: NuxtProjectContext): void {
  server.tool(
    'list_composables',
    'List all composables, both auto-imported and explicit. Returns name, file path, parameters, and return type. Use this to discover reusable logic before writing new code.',
    { name: z.string().optional().describe('Optional substring filter on composable name') },
    safe(async ({ name }) => {
      const { composables } = await ctx.snapshot();
      let filtered = composables;
      if (name) filtered = composables.filter((c) => c.name.toLowerCase().includes(name.toLowerCase()));
      return jsonResult({
        count: filtered.length,
        total: composables.length,
        autoImportedCount: composables.filter((c) => c.autoImported).length,
        composables: filtered,
      });
    }),
  );
}
