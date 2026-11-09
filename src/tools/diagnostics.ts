/**
 * Diagnostics tools: check_type_errors (analyze_bundle_deps added separately).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';
import { runTscCheck } from '../utils/tsc-checker.js';

export function registerDiagnosticTools(server: McpServer, ctx: NuxtProjectContext): void {
  server.tool(
    'check_type_errors',
    'Run a TypeScript type check against .nuxt/tsconfig.json (or the project tsconfig.json) and return structured diagnostics with file, line, column, code and severity.',
    safe(async () => {
      const result = await runTscCheck(ctx.root);
      return jsonResult({
        ran: result.ran,
        errors: result.diagnostics.filter((d) => d.severity === 'error').length,
        warnings: result.diagnostics.filter((d) => d.severity === 'warning').length,
        command: result.command,
        diagnostics: result.diagnostics,
      });
    }),
  );
}
