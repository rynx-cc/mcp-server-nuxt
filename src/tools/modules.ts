/**
 * Nuxt module tools: list_modules.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';

export function registerModuleTools(server: McpServer, ctx: NuxtProjectContext): void {
  server.tool(
    'list_modules',
    'List Nuxt modules discovered from nuxt.config and package.json, with version, status (active/inactive) and source. Use this to understand which Nuxt features are available.',
    {
      status: z.enum(['active', 'inactive']).optional().describe('Filter by module status'),
    },
    safe(async ({ status }) => {
      const { modules } = await ctx.snapshot();
      let filtered = modules;
      if (status) filtered = modules.filter((m) => m.status === status);
      return jsonResult({
        count: filtered.length,
        active: modules.filter((m) => m.status === 'active').length,
        modules: filtered,
      });
    }),
  );
}
