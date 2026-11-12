/**
 * Project overview tools: get_project_overview, get_type_info.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';

export function registerOverviewTools(server: McpServer, ctx: NuxtProjectContext): void {
  server.tool(
    'get_project_overview',
    'Get a high-level overview of the Nuxt project: root, name, Nuxt version, config file, directory layout, layer list, and counts of routes, components, composables, server routes, middleware, plugins and modules.',
    safe(async () => {
      const { overview } = await ctx.snapshot();
      if (!overview.built) {
        return jsonResult({
          ...overview,
          hint:
            'No project `.nuxt` directory (optional). Listing tools use source scan; type tools auto-generate into a cache when nuxt is installed, or fall back to a scanned registry.',
        });
      }
      return jsonResult(overview);
    }),
  );

  server.tool(
    'get_type_info',
    'Read generated Nuxt type information (imports.d.ts, types/*, nuxt.schema.json). Auto-generates types into a cache when `.nuxt` is missing — no nuxi prepare required.',
    safe(async () => {
      const info = await ctx.typeInfo();
      // Always return a useful payload — never bare {}.
      if (!info.importsDts) {
        return jsonResult({
          source: info.source ?? 'none',
          typesRoot: info.typesRoot ?? null,
          importsDts: null,
          typesDir: info.typesDir ?? [],
          schema: info.schema ?? null,
          error: info.error
            ? { code: 'NOT_PREPARED', message: info.error, hint: info.hint }
            : undefined,
          hint:
            info.hint ??
            'No generated type declarations found. Install nuxt to enable auto type generation, or run `nuxi prepare`.',
          fallbackSummary: info.fallbackSummary,
        });
      }
      return jsonResult(info);
    }),
  );
}
