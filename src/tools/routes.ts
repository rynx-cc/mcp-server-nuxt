/**
 * Page route tools: list_routes, get_route.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';

export function registerRouteTools(server: McpServer, ctx: NuxtProjectContext): void {
  server.tool(
    'list_routes',
    'List all page routes with their resolved URL paths, source files, params, middleware, layouts and children. Use this to understand the page/routing surface of the project.',
    {
      pattern: z
        .string()
        .optional()
        .describe('Optional substring filter matched against the route path or file'),
    },
    safe(async ({ pattern }) => {
      const { routes } = await ctx.snapshot();
      let filtered = routes;
      if (pattern) {
        const needle = pattern.toLowerCase();
        filtered = routes.filter(
          (r) => r.path.toLowerCase().includes(needle) || r.file.toLowerCase().includes(needle),
        );
      }
      return jsonResult({ count: filtered.length, total: routes.length, routes: filtered });
    }),
  );

  server.tool(
    'get_route',
    'Get detailed information about a single page route by its resolved URL path (e.g. /users/:id).',
    {
      path: z.string().describe('The resolved route path, e.g. /users/:id'),
    },
    safe(async ({ path }) => {
      const { routes } = await ctx.snapshot();
      const route = routes.find((r) => r.path === path);
      if (!route) {
        return jsonResult({
          found: false,
          path,
          suggestions: routes
            .filter((r) => r.path.includes(path) || path.includes(r.path))
            .slice(0, 10)
            .map((r) => r.path),
        });
      }
      return jsonResult({ found: true, route });
    }),
  );
}
