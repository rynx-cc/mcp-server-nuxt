/**
 * Config tools: read_config, update_config.
 */
import { promises as fs } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NuxtProjectContext } from '../context.js';
import { jsonResult, safe } from '../utils/helpers.js';
import { getConfigValue, setConfigValue } from '../utils/config-reader.js';

export function registerConfigTools(server: McpServer, ctx: NuxtProjectContext): void {
  server.tool(
    'read_config',
    'Read the resolved Nuxt config, or a single key by dot-notation (e.g. runtimeConfig.public.apiBase). Omit the key to return the whole config.',
    {
      key: z.string().optional().describe('Dot-notation config key to read'),
    },
    safe(async ({ key }) => {
      const config = await ctx.config();
      return jsonResult({
        configFile: config.configPath,
        sourceKind: config.sourceKind,
        error: config.error,
        value: getConfigValue(config.value, key),
      });
    }),
  );

  server.tool(
    'update_config',
    'Update a nuxt.config value by dot-notation key and write the change back to disk. Returns a diff of the change. Use with caution; this mutates project files.',
    {
      key: z.string().describe('Dot-notation config key, e.g. ssr or runtimeConfig.public.apiBase'),
      value: z
        .string()
        .describe('New value as JSON or a JS expression, e.g. "false" or "\'https://api.example.com\'"'),
    },
    safe(async ({ key, value }) => {
      const config = await ctx.config();
      if (!config.configPath || !config.source) {
        return jsonResult({ ok: false, error: 'No writable nuxt.config file found.' });
      }

      // Prefer a parsed JSON value; fall back to treating the input as a raw JS expression.
      let parsed: unknown;
      let raw: string | undefined;
      try {
        parsed = JSON.parse(value);
      } catch {
        raw = value;
      }

      const { newSource, diff } = setConfigValue(config.source, key, parsed, raw);
      await fs.writeFile(config.configPath, newSource, 'utf8');
      await ctx.invalidate();

      return jsonResult({ ok: true, key, configFile: config.configPath, diff });
    }),
  );
}
