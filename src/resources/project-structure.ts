/**
 * nuxt://project/overview resource: high-level project summary.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NuxtProjectContext } from '../context.js';

const OVERVIEW_URI = 'nuxt://project/overview';

export function registerProjectStructureResource(server: McpServer, ctx: NuxtProjectContext): void {
  server.registerResource(
    'project-overview',
    OVERVIEW_URI,
    {
      title: 'Nuxt Project Overview',
      description: 'High-level overview of the Nuxt project structure and counts',
      mimeType: 'application/json',
    },
    async () => {
      const { overview } = await ctx.snapshot();
      return {
        contents: [
          {
            uri: OVERVIEW_URI,
            mimeType: 'application/json',
            text: JSON.stringify(overview, null, 2),
          },
        ],
      };
    },
  );
}
