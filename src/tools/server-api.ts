/**
 * Nitro server tools: list_server_routes, scaffold_nitro_api.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';
import { routePathToNitroFile } from '../utils/nuxt-parser.js';
import { prepareWrite } from '../utils/write-path.js';

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
      if (type === 'api') routes = serverRoutes.filter((r) => r.kind === 'api' || r.kind === 'route');
      else if (type) routes = serverRoutes.filter((r) => r.kind === type);

      const grouped = {
        api: serverRoutes.filter((r) => r.kind === 'api' || r.kind === 'route').length,
        middleware: serverRoutes.filter((r) => r.kind === 'middleware').length,
        plugin: serverRoutes.filter((r) => r.kind === 'plugin').length,
      };

      return jsonResult({ count: routes.length, totals: grouped, routes });
    }),
  );

  server.tool(
    'scaffold_nitro_api',
    'Generate a new Nitro server API handler under the project server/api directory (honoring serverDir) with H3 defineEventHandler and optional Zod body validation.',
    {
      path: z.string().describe('API path, e.g. /api/hello or /api/users/:id'),
      method: z.enum(['get', 'post', 'put', 'patch', 'delete']).optional().describe('HTTP method (default: handle all methods)'),
      zod: z.boolean().optional().describe('Include readValidatedBody with a Zod schema (default false)'),
      dryRun: z.boolean().optional().describe('When true (default), return the planned file without writing'),
    },
    safe(async ({ path: apiPath, method, zod, dryRun }) => {
      const auth = ctx.writeGuard.authorize(dryRun ?? true);
      if (!auth.ok) return jsonResult(auth);

      const dirs = await ctx.sourceDirs();
      const rel = routePathToNitroFile(apiPath, method).replace(/^server\//, '');
      const { file, exists: alreadyExists } = await prepareWrite(
        ctx.root,
        dirs.serverDir,
        path.resolve(dirs.serverDir, rel),
      );
      const content = zod
        ? "import { z } from 'zod'\n\nexport default defineEventHandler(async (event) => {\n  const body = await readValidatedBody(event, z.object({}).passthrough().safeParse)\n  if (!body.success) throw createError({ statusCode: 400, statusMessage: 'Invalid body' })\n  return body.data\n})\n"
        : "export default defineEventHandler((event) => {\n  return { ok: true }\n})\n";

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
