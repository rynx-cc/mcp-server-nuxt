/**
 * Project overview tools and the nuxt://project/overview resource.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';

const OVERVIEW_URI = 'nuxt://project/overview';

export function registerOverviewTools(server: McpServer, ctx: NuxtProjectContext): void {
  server.tool(
    'get_project_overview',
    'Get a high-level overview of the Nuxt project: root, name, Nuxt version, config file, directory layout, and counts of routes, components, composables, server routes, middleware, plugins and modules.',
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

  server.registerResource(
    'project-overview',
    OVERVIEW_URI,
    {
      title: 'Nuxt Project Overview',
      description: 'High-level overview of the Nuxt project structure and counts',
      mimeType: 'application/json',
    },
    async () => {
      const { overview } = await ctx.snapshot();
      return {
        contents: [
          {
            uri: OVERVIEW_URI,
            mimeType: 'application/json',
            text: JSON.stringify(overview, null, 2),
          },
        ],
      };
    },
  );
}
