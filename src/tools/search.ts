/**
 * Code search tools: search_code, get_nuxt_docs.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';
import { searchCode } from '../utils/nuxt-parser.js';
import { getNuxtDocs, listNuxtDocsTopics } from '../data/nuxt-docs.js';

export function registerSearchTools(server: McpServer, ctx: NuxtProjectContext): void {
  server.tool(
    'search_code',
    'Search project source files for a substring or regex. Returns matching files with line/column numbers and surrounding context lines.',
    {
      query: z.string().describe('Substring or regex to search for'),
      fileTypes: z
        .array(z.string())
        .optional()
        .describe('Optional file extensions, e.g. ["vue", "ts"]'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Maximum number of results (default 50; alias of limit)'),
      limit: z.number().int().min(1).max(200).optional().describe('Maximum number of results (default 50)'),
      offset: z.number().int().min(0).optional().describe('Skip the first N matches (default 0)'),
    },
    safe(async ({ query, fileTypes, maxResults, limit, offset }) => {
      const cap = limit ?? maxResults ?? 50;
      const skip = offset ?? 0;
      // Fetch enough matches to apply offset, then trim to limit.
      const matches = await searchCode(ctx.root, query, fileTypes, skip + cap);
      const page = matches.slice(skip, skip + cap);
      return jsonResult({
        query,
        count: page.length,
        totalMatched: matches.length,
        limit: cap,
        offset: skip,
        truncated: matches.length >= skip + cap,
        matches: page,
      });
    }),
  );

  server.tool(
    'get_nuxt_docs',
    'Get targeted offline Nuxt documentation guidance for a feature area (routing, nitro, modules, layers, composables, config, components).',
    {
      topic: z.string().describe('Feature topic, e.g. routing, nitro, modules, layers'),
    },
    safe(async ({ topic }) => {
      const doc = getNuxtDocs(topic);
      if (!doc) return jsonResult({ found: false, topic, available: listNuxtDocsTopics() });
      return jsonResult({ found: true, ...doc });
    }),
  );
}
