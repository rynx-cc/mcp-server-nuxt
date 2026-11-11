/**
 * Page route tools: list_routes, get_route, add_route.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';
import { routePathToFile } from '../utils/nuxt-parser.js';
import { prepareWrite } from '../utils/write-path.js';

function jsSingleQuoted(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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
    'Scaffold a new page route under the project pages directory (honoring srcDir) following Nuxt conventions. Supports static, dynamic (:id -> [id]), optional ([[id]]), optional catch-all ([[...slug]]), and catch-all ([...slug]) segments.',
    {
      path: z.string().describe('Route path, e.g. /users/:id or /about'),
      layout: z.string().optional().describe('Optional layout name to set in definePageMeta'),
      middleware: z.array(z.string()).optional().describe('Optional middleware names to set in definePageMeta'),
      dryRun: z.boolean().optional().describe('When true (default), return the planned file without writing'),
    },
    safe(async ({ path: routePath, layout, middleware, dryRun }) => {
      const auth = ctx.writeGuard.authorize(dryRun ?? true);
      if (!auth.ok) return jsonResult(auth);

      const dirs = await ctx.sourceDirs();
      const pagesName = path.basename(dirs.pagesDir);
      const rel = routePathToFile(routePath, pagesName);
      const prefix = `${pagesName}/`;
      if (!rel.startsWith(prefix)) {
        throw new Error(`Refusing to scaffold a page outside ${pagesName}/`);
      }
      const { file, exists: alreadyExists } = await prepareWrite(
        ctx.root,
        dirs.pagesDir,
        path.resolve(dirs.pagesDir, rel.slice(prefix.length)),
      );
      const meta: string[] = [];
      if (layout) meta.push(`  layout: ${jsSingleQuoted(layout)}`);
      if (middleware && middleware.length > 0) {
        meta.push(`  middleware: [${middleware.map((item) => jsSingleQuoted(item)).join(', ')}]`);
      }
      const metaBlock = meta.length > 0 ? `\ndefinePageMeta({\n${meta.join(',\n')}\n})` : '';
      const content = `<script setup>${metaBlock}\n</script>\n\n<template>\n  <div>${escapeHtml(routePath)}</div>\n</template>\n`;

      if (dryRun ?? true) return jsonResult({ written: false, dryRun: true, exists: alreadyExists, path: file, content });
      if (alreadyExists) {
        return jsonResult({ ok: false, written: false, exists: true, path: file, error: `Refusing to overwrite existing file: ${file}` });
      }
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content, 'utf8');
      return jsonResult({ written: true, path: file });
    }),
  );
}
