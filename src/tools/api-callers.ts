/**
 * API caller tool: find_api_callers.
 */
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';
import { findApiCallers } from '../utils/api-callers.js';
import { listServerRoutes } from '../utils/nuxt-parser.js';

export function registerApiCallerTools(server: McpServer, ctx: NuxtProjectContext): void {
  server.tool(
    'find_api_callers',
    'Find every page/component/composable/layout/plugin/middleware/util that calls a server API route via useFetch, useLazyFetch, $fetch, or useAsyncData($fetch). Accepts a handler file path (server/api/users/[id].get.ts) or a concrete URL (/api/users/42). Static analysis only — no DevServer or nuxi prepare.',
    {
      target: z
        .string()
        .describe('Server API route target: a handler file path or a concrete URL, e.g. server/api/users/[id].get.ts or /api/users/42'),
      root: z
        .string()
        .optional()
        .describe('Optional project root override (defaults to the server project path)'),
    },
    safe(async ({ target, root }) => {
      const projectRoot = root ? path.resolve(root) : ctx.root;
      let serverRoutes;
      if (projectRoot === ctx.root) {
        serverRoutes = (await ctx.snapshot()).serverRoutes;
      } else {
        serverRoutes = await listServerRoutes(projectRoot);
      }
      const result = await findApiCallers(projectRoot, target, serverRoutes);
      return jsonResult(result);
    }),
  );
}
