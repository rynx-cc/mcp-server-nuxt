import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setupServer } from '../src/server.js';
import { extractFetchCalls, findApiCallers } from '../src/utils/api-callers.js';
import { listServerRoutes } from '../src/utils/nuxt-parser.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'nuxt3-minimal');

type Tool = {
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: Array<{ text: string }> }>;
};

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = (server as unknown as { _registeredTools: Record<string, Tool> })._registeredTools[name]!;
  const result = await tool.handler(args, {});
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

async function tempProject(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-callers-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }
  return dir;
}

describe('extractFetchCalls', () => {
  it('extracts useFetch, $fetch, template strings and useAsyncData($fetch)', () => {
    const calls = extractFetchCalls(
      [
        "const a = useFetch('/api/hello')",
        'const b = useFetch(`/api/users/${id}`, { method: "POST" })',
        "const c = $fetch('/api/hello')",
        "const d = await useAsyncData('x', () => $fetch('/api/hello'))",
      ].join('\n'),
    );
    expect(calls.map((c) => c.composable)).toEqual(['useFetch', 'useFetch', '$fetch', 'useAsyncData']);
    expect(calls[0]!.url).toBe('/api/hello');
    expect(calls[1]!.url).toBe('/api/users/${id}');
    expect(calls[1]!.template).toBe(true);
    expect(calls[1]!.method).toBe('POST');
    expect(calls[3]!.url).toBe('/api/hello');
  });
});

describe('find_api_callers (fixture)', () => {
  it('resolves a handler file path and finds template + literal callers', async () => {
    const result = await findApiCallers(fixture, 'server/api/users/[id].get.ts', await listServerRoutes(fixture));
    expect(result.target).toEqual({
      file: 'server/api/users/[id].get.ts',
      pattern: '/api/users/:id',
      method: 'GET',
    });
    const files = result.callers.map((c) => c.file);
    expect(files).toContain('components/ApiCard.vue');
    expect(files).toContain('composables/useApiClient.ts');
    expect(result.callers.every((c) => c.kind === 'component' || c.kind === 'composable')).toBe(true);
    expect(result.callers.every((c) => c.url.includes('/api/users/'))).toBe(true);
  });

  it('resolves a concrete URL and finds literal callers', async () => {
    const result = await findApiCallers(fixture, '/api/hello', await listServerRoutes(fixture));
    expect(result.target.file).toContain('server/api/hello');
    const files = result.callers.map((c) => c.file);
    expect(files).toContain('pages/users/[id].vue');
    expect(files).toContain('components/ApiCard.vue');
    expect(files).toContain('composables/useApiClient.ts');
  });

  it('matches template strings against dynamic API routes', async () => {
    const result = await findApiCallers(fixture, '/api/users/42', await listServerRoutes(fixture));
    expect(result.target.pattern).toBe('/api/users/:id');
    expect(result.callers.length).toBe(2);
    expect(result.callers.every((c) => c.url === '/api/users/${id}')).toBe(true);
  });

  it('MCP tool find_api_callers returns JSON', async () => {
    const server = new McpServer({ name: 't', version: '0.0.0' });
    const { watcher } = await setupServer(server, fixture);
    try {
      const result = await callTool(server, 'find_api_callers', { target: '/api/hello' });
      expect(result.error).toBeUndefined();
      expect((result.target as { file: string }).file).toContain('server/api/hello');
      expect((result.callers as Array<{ file: string }>).length).toBeGreaterThan(0);
    } finally {
      watcher.stop();
    }
  });
});

describe('find_api_callers (method mismatch and unresolved)', () => {
  it('excludes method-mismatched calls and explains them', async () => {
    const dir = await tempProject({
      'nuxt.config.ts': 'export default defineNuxtConfig({})',
      'server/api/hello.post.ts': 'export default defineEventHandler(() => ({}))',
      'pages/index.vue': `<script setup>
const ok = await useFetch('/api/hello', { method: 'POST' })
const wrong = await useFetch('/api/hello')
</script>`,
    });
    try {
      const result = await findApiCallers(dir, '/api/hello');
      expect(result.callers).toHaveLength(1);
      expect(result.notes.length).toBe(1);
      expect(result.notes[0]).toMatch(/GET/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('collects dynamic, unresolvable URLs instead of guessing', async () => {
    const dir = await tempProject({
      'nuxt.config.ts': 'export default defineNuxtConfig({})',
      'server/api/hello.get.ts': 'export default defineEventHandler(() => ({}))',
      'pages/index.vue': `<script setup>
const url = buildUrl()
const data = await $fetch(url)
</script>`,
    });
    try {
      const result = await findApiCallers(dir, '/api/hello');
      expect(result.callers).toHaveLength(0);
      expect(result.unresolved).toHaveLength(1);
      expect(result.unresolved[0]!.composable).toBe('$fetch');
      expect(result.unresolved[0]!.url).toBe('url');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('finds useAsyncData($fetch) callers', async () => {
    const dir = await tempProject({
      'nuxt.config.ts': 'export default defineNuxtConfig({})',
      'server/api/hello.get.ts': 'export default defineEventHandler(() => ({}))',
      'composables/useHello.ts': `export function useHello() {
  return useAsyncData('hello', () => $fetch('/api/hello'))
}`,
    });
    try {
      const result = await findApiCallers(dir, '/api/hello');
      expect(result.callers).toHaveLength(1);
      expect(result.callers[0]!.composable).toBe('useAsyncData');
      expect(result.callers[0]!.kind).toBe('composable');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
