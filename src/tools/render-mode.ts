/**
 * Render-mode tool: explain_render_mode.
 */
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';
import { explainRenderMode } from '../utils/render-mode.js';

export function registerRenderModeTools(server: McpServer, ctx: NuxtProjectContext): void {
  server.tool(
    'explain_render_mode',
    'Explain how Nitro resolves the render mode for a concrete URL from nuxt.config routeRules / nitro.routeRules (ssr, spa, prerender, isr, swr, static) plus cache, redirect, cors, headers and proxy. Static analysis only — no DevServer or nuxi prepare.',
    {
      route: z.string().describe('Concrete URL path to explain, e.g. /blog/hello or /old'),
      root: z
        .string()
        .optional()
        .describe('Optional project root override (defaults to the server project path)'),
    },
    safe(async ({ route, root }) => {
      const projectRoot = root ? path.resolve(root) : ctx.root;
      const result = await explainRenderMode(projectRoot, route);
      return jsonResult(result);
    }),
  );
}
