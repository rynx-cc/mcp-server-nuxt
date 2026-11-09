/**
 * nuxt://project/layers resource: resolved extends hierarchy.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NuxtProjectContext } from '../context.js';

const LAYERS_URI = 'nuxt://project/layers';

export function registerLayersResource(server: McpServer, ctx: NuxtProjectContext): void {
  server.registerResource(
    'project-layers',
    LAYERS_URI,
    {
      title: 'Nuxt Layers',
      description: 'Resolved extends hierarchy with override priority order',
      mimeType: 'application/json',
    },
    async () => {
      const layers = await ctx.layers();
      return {
        contents: [
          {
            uri: LAYERS_URI,
            mimeType: 'application/json',
            text: JSON.stringify({ count: layers.length, layers }, null, 2),
          },
        ],
      };
    },
  );
}
