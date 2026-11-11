/**
 * Composable tools: list_composables, get_auto_imports, generate_composable.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
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
      if (!built) {
        return jsonResult({
          built: false,
          count: 0,
          total: 0,
          imports: [],
          hint: 'No .nuxt/imports.d.ts found. Run `nuxi prepare` (or `nuxi build`) to generate auto-import types.',
        });
      }
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

  server.tool(
    'generate_composable',
    'Generate a new composable under composables/ with a typed export. Names are normalized to useXxx.',
    {
      name: z.string().describe('Composable name, e.g. useCounter or counter'),
      returns: z.string().optional().describe('Optional return type annotation, e.g. { count: Ref<number> }'),
      dryRun: z.boolean().optional().describe('When true (default), return the planned file without writing'),
    },
    safe(async ({ name, returns, dryRun }) => {
      const auth = ctx.writeGuard.authorize(dryRun ?? true);
      if (!auth.ok) return jsonResult(auth);

      const base = name.replace(/\.(ts|js)$/, '');
      const fnName = /^use[A-Z]/.test(base) ? base : `use${base.charAt(0).toUpperCase()}${base.slice(1)}`;
      const rel = path.join('composables', `${fnName}.ts`);
      const inside = ctx.writeGuard.assertInsideProject(rel);
      if (!inside.ok) return jsonResult(inside);

      const ret = returns ? `: ${returns}` : '';
      const content = `export function ${fnName}()${ret} {\n  // TODO: implement\n  return {}\n}\n`;

      if (dryRun ?? true) return jsonResult({ written: false, dryRun: true, path: inside.path, content });
      await fs.mkdir(path.dirname(inside.path), { recursive: true });
      await fs.writeFile(inside.path, content, 'utf8');
      return jsonResult({ written: true, path: inside.path });
    }),
  );
}
