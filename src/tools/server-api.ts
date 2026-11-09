/**
 * Nitro server tools: list_server_routes.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';

export function registerServerApiTools(server: McpServer, ctx: NuxtProjectContext): void {
  server.tool(
    'list_server_routes',
    'List all Nitro server API routes, middleware, and plugins. Returns route path, handler file, HTTP method, and middleware chain. Use this to understand the server/API surface of the project.',
    {
      type: z.enum(['api', 'middleware', 'plugin']).optional().describe('Filter by route kind'),
    },
    safe(async ({ type }) => {
      const { serverRoutes } = await ctx.snapshot();
      let routes = serverRoutes;
      if (type) routes = serverRoutes.filter((r) => r.kind === type);

      const grouped = {
        api: serverRoutes.filter((r) => r.kind === 'api' || r.kind === 'route').length,
        middleware: serverRoutes.filter((r) => r.kind === 'middleware').length,
        plugin: serverRoutes.filter((r) => r.kind === 'plugin').length,
      };

      return jsonResult({ count: routes.length, totals: grouped, routes });
    }),
  );
}
