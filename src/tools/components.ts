/**
 * Component tools: list_components, get_component.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';

export function registerComponentTools(server: McpServer, ctx: NuxtProjectContext): void {
  server.tool(
    'list_components',
    'List all Vue components with their auto-imported names, file paths, props, emits and slots. Use this to discover existing UI building blocks before writing new code.',
    {
      name: z.string().optional().describe('Optional substring filter on component name'),
      directory: z.string().optional().describe('Optional directory filter (e.g. components)'),
    },
    safe(async ({ name, directory }) => {
      const { components } = await ctx.snapshot();
      let filtered = components;
      if (name) filtered = filtered.filter((c) => c.name.toLowerCase().includes(name.toLowerCase()));
      if (directory) filtered = filtered.filter((c) => c.directory === directory);
      return jsonResult({ count: filtered.length, total: components.length, components: filtered });
    }),
  );

  server.tool(
    'get_component',
    'Get detailed information about a single component by its auto-imported name (e.g. BaseButton).',
    {
      name: z.string().describe('Auto-imported component name, e.g. BaseButton'),
    },
    safe(async ({ name }) => {
      const { components } = await ctx.snapshot();
      const component = components.find((c) => c.name === name);
      if (!component) {
        return jsonResult({
          found: false,
          name,
          suggestions: components
            .filter((c) => c.name.toLowerCase().includes(name.toLowerCase()))
            .slice(0, 10)
            .map((c) => c.name),
        });
      }
      return jsonResult({ found: true, component });
    }),
  );
}
