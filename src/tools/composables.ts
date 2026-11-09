/**
 * Composable tools: list_composables, get_auto_imports.
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

  server.tool(
    'get_auto_imports',
    'Read the .nuxt/imports.d.ts auto-imports registry: every auto-imported symbol with its source path and type signature. Requires the project to have been prepared/built. Use this instead of guessing import paths or function signatures.',
    {
      filter: z.string().optional().describe('Optional substring filter on the symbol name or source path'),
    },
    safe(async ({ filter }) => {
      const { built, imports } = await ctx.autoImports();
      let filtered = imports;
      if (filter) {
        const needle = filter.toLowerCase();
        filtered = imports.filter(
          (i) => i.name.toLowerCase().includes(needle) || i.source.toLowerCase().includes(needle),
        );
      }
      return jsonResult({ built, count: filtered.length, total: imports.length, imports: filtered });
    }),
  );
}
