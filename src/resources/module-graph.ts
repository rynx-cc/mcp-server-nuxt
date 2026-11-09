/**
 * nuxt://project/modules resource: installed modules and configuration.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NuxtProjectContext } from '../context.js';

const MODULES_URI = 'nuxt://project/modules';

export function registerModuleGraphResource(server: McpServer, ctx: NuxtProjectContext): void {
  server.registerResource(
    'project-modules',
    MODULES_URI,
    {
      title: 'Nuxt Modules',
      description: 'Installed Nuxt modules with status, source and configuration',
      mimeType: 'application/json',
    },
    async () => {
      const { modules } = await ctx.snapshot();
      return {
        contents: [
          {
            uri: MODULES_URI,
            mimeType: 'application/json',
            text: JSON.stringify({ count: modules.length, modules }, null, 2),
          },
        ],
      };
    },
  );
}
