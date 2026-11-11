/**
 * Diagnostics tools: check_type_errors, analyze_bundle_deps, analyze_project.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';
import { runTscCheck } from '../utils/tsc-checker.js';
import { analyzeBundleDeps, analyzeProject } from '../utils/nuxt-parser.js';

export function registerDiagnosticTools(server: McpServer, ctx: NuxtProjectContext): void {
  server.tool(
    'check_type_errors',
    'Run a TypeScript type check against .nuxt/tsconfig.json (or the project tsconfig.json) and return structured diagnostics with file, line, column, code and severity.',
    safe(async () => {
      const result = await runTscCheck(ctx.root);
      const payload: Record<string, unknown> = {
        ran: result.ran,
        errors: result.diagnostics.filter((d) => d.severity === 'error').length,
        warnings: result.diagnostics.filter((d) => d.severity === 'warning').length,
        command: result.command,
        diagnostics: result.diagnostics,
      };
      if (!result.ran) {
        payload.hint = 'Typecheck skipped. Run `nuxi prepare` so .nuxt/tsconfig.json exists, then retry.';
      }
      return jsonResult(payload);
    }),
  );

  server.tool(
    'analyze_bundle_deps',
    'Analyze package.json dependencies: classify Nuxt modules vs runtime/dev dependencies and surface warnings for misplaced or missing modules.',
    safe(async () => {
      return jsonResult(await analyzeBundleDeps(ctx.root));
    }),
  );

  server.tool(
    'analyze_project',
    'Analyze overall project health: overview counts, dependency warnings, component sample with pagination, and hints (e.g. run nuxi prepare when .nuxt is missing).',
    {
      limit: z.number().int().min(1).max(1000).optional().describe('Max component/package items (default 50)'),
      offset: z.number().int().min(0).optional().describe('Offset into the component list (default 0)'),
    },
    safe(async ({ limit, offset }) => {
      const snap = await ctx.snapshot();
      return jsonResult(
        await analyzeProject(ctx.root, {
          overview: snap.overview,
          routes: snap.routes,
          components: snap.components,
          modules: snap.modules,
        }, { limit, offset }),
      );
    }),
  );
}
