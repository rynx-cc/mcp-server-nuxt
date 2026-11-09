/**
 * nuxt://project/routes resource: full resolved route map.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NuxtProjectContext } from '../context.js';

const ROUTES_URI = 'nuxt://project/routes';

export function registerRouteMapResource(server: McpServer, ctx: NuxtProjectContext): void {
  server.registerResource(
    'project-routes',
    ROUTES_URI,
    {
      title: 'Nuxt Route Map',
      description: 'Full resolved route map with files, params, middleware and layouts',
      mimeType: 'application/json',
    },
    async () => {
      const { routes } = await ctx.snapshot();
      return {
        contents: [
          {
            uri: ROUTES_URI,
            mimeType: 'application/json',
            text: JSON.stringify({ count: routes.length, routes }, null, 2),
          },
        ],
      };
    },
  );
}
