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
      return jsonResult(overview);
    }),
  );

  server.tool(
    'get_type_info',
    'Read generated Nuxt type information (.nuxt/imports.d.ts, .nuxt/types files and nuxt.schema.json) when the project has been built.',
    safe(async () => {
      return jsonResult(await ctx.typeInfo());
    }),
  );
}
