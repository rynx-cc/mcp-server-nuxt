/**
 * nuxt://project/config resource: resolved Nuxt config object.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NuxtProjectContext } from '../context.js';

const CONFIG_URI = 'nuxt://project/config';

export function registerNuxtConfigResource(server: McpServer, ctx: NuxtProjectContext): void {
  server.registerResource(
    'project-config',
    CONFIG_URI,
    {
      title: 'Nuxt Config',
      description: 'Current resolved Nuxt configuration object',
      mimeType: 'application/json',
    },
    async () => {
      const config = await ctx.config();
      return {
        contents: [
          {
            uri: CONFIG_URI,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                configFile: config.configPath,
                sourceKind: config.sourceKind,
                error: config.error,
                value: config.value,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
