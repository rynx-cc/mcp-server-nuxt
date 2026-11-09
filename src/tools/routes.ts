/**
 * Page route tools: list_routes, get_route, add_route.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';
import { routePathToFile } from '../utils/nuxt-parser.js';

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

  server.tool(
    'add_route',
    'Scaffold a new page route under pages/ following Nuxt conventions. Supports static, dynamic (:id -> [id]), optional ([[id]]), and catch-all ([...slug]) segments.',
    {
      path: z.string().describe('Route path, e.g. /users/:id or /about'),
      layout: z.string().optional().describe('Optional layout name to set in definePageMeta'),
      middleware: z.array(z.string()).optional().describe('Optional middleware names to set in definePageMeta'),
      dryRun: z.boolean().optional().describe('When true (default), return the planned file without writing'),
    },
    safe(async ({ path: routePath, layout, middleware, dryRun }) => {
      const auth = ctx.writeGuard.authorize(dryRun ?? true);
      if (!auth.ok) return jsonResult(auth);

      const file = ctx.p(routePathToFile(routePath));
      const meta: string[] = [];
      if (layout) meta.push(`  layout: '${layout}'`);
      if (middleware && middleware.length > 0) {
        meta.push(`  middleware: [${middleware.map((m) => `'${m}'`).join(', ')}]`);
      }
      const metaBlock = meta.length > 0 ? `\ndefinePageMeta({\n${meta.join(',\n')}\n})` : '';
      const content = `<script setup>${metaBlock}\n</script>\n\n<template>\n  <div>${routePath}</div>\n</template>\n`;

      if (dryRun ?? true) return jsonResult({ written: false, dryRun: true, path: file, content });
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content, 'utf8');
      return jsonResult({ written: true, path: file });
    }),
  );
}
