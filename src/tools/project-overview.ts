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
            'Project has no .nuxt directory yet. Type tools (get_type_info, check_type_errors, get_auto_imports) auto-generate types into a cache outside the project when a local nuxt install is available.',
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
      if (info.error && !info.importsDts) {
        return jsonResult({
          error: {
            code: 'NOT_PREPARED',
            message: info.error,
            hint: info.hint,
          },
          source: info.source,
        });
      }
      return jsonResult(info);
    }),
  );
}
