/**
 * Page analysis tools: inspect_route_meta.
 */
import { promises as fs } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';
import { extractPageMeta, parseVueComponent } from '../utils/nuxt-parser.js';

export function registerPageTools(server: McpServer, ctx: NuxtProjectContext): void {
  server.tool(
    'inspect_route_meta',
    'Inspect a single route: returns route params, middleware, layout, page meta plus the component props, emits and slots. Accepts a route path (e.g. /users/:id) or a page file path.',
    {
      path: z.string().describe('Route path (e.g. /users/:id) or page file (e.g. pages/users/[id].vue)'),
    },
    safe(async ({ path }) => {
      const { routes } = await ctx.snapshot();
      const route = routes.find((r) => r.path === path || r.file === path);

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

      const content = await fs.readFile(route.absolutePath, 'utf8');
      const { meta, middleware, layout } = extractPageMeta(content);
      const { props, emits, slots, hasScriptSetup } = await parseVueComponent(route.absolutePath);

      return jsonResult({
        found: true,
        route: { ...route, meta, middleware, layout },
        component: { props, emits, slots, hasScriptSetup },
        sourceLength: content.length,
      });
    }),
  );
}
