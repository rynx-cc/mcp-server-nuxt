/**
 * nuxt://project/auto-imports and nuxt://project/types resources.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NuxtProjectContext } from '../context.js';

const AUTO_IMPORTS_URI = 'nuxt://project/auto-imports';
const TYPES_URI = 'nuxt://project/types';

export function registerAutoImportsResource(server: McpServer, ctx: NuxtProjectContext): void {
  server.registerResource(
    'project-auto-imports',
    AUTO_IMPORTS_URI,
    {
      title: 'Nuxt Auto-imports Registry',
      description: 'Every auto-imported symbol with source path and type signature (from .nuxt/imports.d.ts)',
      mimeType: 'application/json',
    },
    async () => {
      const { built, imports } = await ctx.autoImports();
      return {
        contents: [
          {
            uri: AUTO_IMPORTS_URI,
            mimeType: 'application/json',
            text: JSON.stringify({ built, count: imports.length, imports }, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'project-types',
    TYPES_URI,
    {
      title: 'Nuxt Generated Types',
      description: 'Raw generated type info (.nuxt/imports.d.ts, .nuxt/types file list, nuxt.schema.json)',
      mimeType: 'application/json',
    },
    async () => {
      const info = await ctx.typeInfo();
      return {
        contents: [
          {
            uri: TYPES_URI,
            mimeType: 'application/json',
            text: JSON.stringify(info, null, 2),
          },
        ],
      };
    },
  );
}
