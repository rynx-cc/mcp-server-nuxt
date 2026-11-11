/**
 * Nuxt module tools: list_modules, add_nuxt_module.
 */
import { promises as fs } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';
import { appendModule } from '../utils/config-reader.js';

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

  server.tool(
    'add_nuxt_module',
    'Add a Nuxt module to the modules array in nuxt.config, optionally with options. Returns a diff; dry-run by default.',
    {
      name: z.string().describe('Module name, e.g. @nuxtjs/i18n'),
      options: z.string().optional().describe('Optional module options as a JSON object string, e.g. {\"locales\": [\"en\"]}'),
      dryRun: z.boolean().optional().describe('When true (default), return the planned change without writing'),
    },
    safe(async ({ name, options, dryRun }) => {
      const auth = ctx.writeGuard.authorize(dryRun ?? true);
      if (!auth.ok) return jsonResult(auth);

      const config = await ctx.config();
      if (!config.configPath || !config.source) {
        return jsonResult({
          error: { code: 'NOT_FOUND', message: 'No writable nuxt.config file found.', hint: 'Point the server at a Nuxt project root.' },
        });
      }
      const inside = ctx.writeGuard.assertInsideProject(config.configPath);
      if (!inside.ok) return jsonResult(inside);

      let parsedOptions: unknown;
      if (options !== undefined) {
        try {
          parsedOptions = JSON.parse(options);
        } catch {
          return jsonResult({
            error: { code: 'INVALID_ARGUMENT', message: 'options must be a valid JSON object string' },
          });
        }
      }

      const { newSource, diff } = appendModule(config.source, name, parsedOptions);
      if (dryRun ?? true) {
        return jsonResult({ ok: true, written: false, dryRun: true, module: name, diff });
      }

      await fs.writeFile(inside.path, newSource, 'utf8');
      await ctx.invalidate();
      return jsonResult({ ok: true, written: true, module: name, diff });
    }),
  );
}
