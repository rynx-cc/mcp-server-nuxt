import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setupServer } from '../src/server.js';
import { buildFallbackAutoImports, BUILTIN_NUXT_IMPORTS } from '../src/utils/fallback-imports.js';

const fixturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

type Tool = {
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: Array<{ text: string }> }>;
};

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = (server as unknown as { _registeredTools: Record<string, Tool> })._registeredTools[name]!;
  const result = await tool.handler(args, {});
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe('fallback auto-imports (unit)', () => {
  it('merges builtins with scanned components and composables', () => {
    const imports = buildFallbackAutoImports(
      [{ name: 'BaseButton', file: 'components/BaseButton.vue', absolutePath: '/x', directory: 'components', props: [], emits: [], slots: [], autoImported: true, isPage: false }],
      [{ name: 'useCounter', file: 'composables/useCounter.ts', absolutePath: '/y', autoImported: true, directory: 'composables' }],
    );
    expect(imports.some((i) => i.name === 'useFetch')).toBe(true);
    expect(imports.some((i) => i.name === 'useCounter' && i.source.includes('composables'))).toBe(true);
    expect(imports.some((i) => i.name === 'BaseButton' && i.kind === 'component')).toBe(true);
    expect(imports.length).toBeGreaterThanOrEqual(BUILTIN_NUXT_IMPORTS.length + 2);
  });
});

describe('no-prepare fixture — type tools without .nuxt / without nuxt install', () => {
  it('get_auto_imports / get_type_info / check_type_errors return meaningful payloads and leave no .nuxt', async () => {
    const root = path.join(fixturesRoot, 'no-prepare');
    expect(existsSync(path.join(root, 'node_modules', 'nuxt'))).toBe(false);
    expect(existsSync(path.join(root, '.nuxt'))).toBe(false);

    const server = new McpServer({ name: 'fallback', version: '0.0.0' });
    const { watcher } = await setupServer(server, root);
    try {
      const auto = await callTool(server, 'get_auto_imports');
      expect(auto.source).toBe('fallback');
      expect(auto.built).toBe(true);
      expect((auto.count as number) > 0).toBe(true);
      const names = ((auto.imports as Array<{ name: string }>) ?? []).map((i) => i.name);
      expect(names).toContain('useState');
      expect(names).toContain('navigateTo');

      const typeInfo = await callTool(server, 'get_type_info');
      expect(typeInfo).not.toEqual({});
      expect(typeInfo.source).toBe('none');
      expect(typeof typeInfo.hint === 'string' && (typeInfo.hint as string).length > 0).toBe(true);
      expect(typeInfo.fallbackSummary).toBeTruthy();

      const check = await callTool(server, 'check_type_errors');
      expect(check.error).toBeUndefined();
      expect(typeof check.hint === 'string' || check.ran === true || check.ran === false).toBe(true);
      expect(check.source === 'none' || check.typesRoot == null).toBe(true);

      expect(existsSync(path.join(root, '.nuxt'))).toBe(false);
    } finally {
      watcher.stop();
    }
  });
});
