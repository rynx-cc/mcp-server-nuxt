import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setupServer } from '../src/server.js';
import { explainRenderMode, matchRouteRulePattern } from '../src/utils/render-mode.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'nuxt3-minimal');

type Tool = {
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: Array<{ text: string }> }>;
};

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = (server as unknown as { _registeredTools: Record<string, Tool> })._registeredTools[name]!;
  const result = await tool.handler(args, {});
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

async function tempProject(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'render-mode-'));
  await fs.writeFile(path.join(dir, 'nuxt.config.ts'), source, 'utf8');
  return dir;
}

describe('matchRouteRulePattern', () => {
  it('matches exact, single wildcard, catch-all and dynamic segments', () => {
    expect(matchRouteRulePattern('/blog', '/blog')).toBe(true);
    expect(matchRouteRulePattern('/blog', '/blog/hello')).toBe(false);
    expect(matchRouteRulePattern('/blog/*', '/blog/hello')).toBe(true);
    expect(matchRouteRulePattern('/blog/*', '/blog/hello/world')).toBe(false);
    expect(matchRouteRulePattern('/blog/**', '/blog')).toBe(true);
    expect(matchRouteRulePattern('/blog/**', '/blog/hello/world')).toBe(true);
    expect(matchRouteRulePattern('/blog/:id', '/blog/42')).toBe(true);
    expect(matchRouteRulePattern('/blog/:id', '/blog')).toBe(false);
  });
});

describe('explain_render_mode (fixture)', () => {
  it('exact match with redirect', async () => {
    const result = await explainRenderMode(fixture, '/old');
    expect(result.matchedRules).toHaveLength(1);
    expect(result.matchedRules[0]!.pattern).toBe('/old');
    expect(result.redirect).toEqual({ to: '/new', statusCode: 302 });
    expect(result.mode).toBe('ssr');
  });

  it('exact prerender rule', async () => {
    const result = await explainRenderMode(fixture, '/about');
    expect(result.mode).toBe('prerender');
    expect(result.matchedRules[0]!.rule).toEqual({ prerender: true });
  });

  it('wildcard ** swr with cache duration', async () => {
    const result = await explainRenderMode(fixture, '/blog/hello/world');
    expect(result.mode).toBe('swr');
    expect(result.cache.swr).toBe(3600);
    expect(result.matchedRules[0]!.pattern).toBe('/blog/**');
  });

  it('wildcard ** ssr:false resolves to spa', async () => {
    const result = await explainRenderMode(fixture, '/admin/dashboard');
    expect(result.mode).toBe('spa');
    expect(result.matchedRules[0]!.rule).toEqual({ ssr: false });
  });

  it('no match defaults to ssr with a note', async () => {
    const result = await explainRenderMode(fixture, '/nope/missing');
    expect(result.mode).toBe('ssr');
    expect(result.matchedRules).toHaveLength(0);
    expect(result.notes.some((n) => n.includes('No routeRules matched'))).toBe(true);
  });

  it('MCP tool explain_render_mode returns JSON', async () => {
    const server = new McpServer({ name: 't', version: '0.0.0' });
    const { watcher } = await setupServer(server, fixture);
    try {
      const result = await callTool(server, 'explain_render_mode', { route: '/blog/hello' });
      expect(result.mode).toBe('swr');
      expect((result.cache as { swr: number }).swr).toBe(3600);
      expect(result.error).toBeUndefined();
    } finally {
      watcher.stop();
    }
  });
});

describe('explain_render_mode (static config edge cases)', () => {
  it('merges multiple matching rules with the most specific winning', async () => {
    const dir = await tempProject(`export default defineNuxtConfig({
  routeRules: {
    '/blog/**': { swr: 3600, headers: { 'x-a': '1' } },
    '/blog/hello': { swr: 60 },
  },
})`);
    try {
      const result = await explainRenderMode(dir, '/blog/hello');
      expect(result.matchedRules.map((r) => r.pattern)).toEqual(['/blog/**', '/blog/hello']);
      expect(result.mode).toBe('swr');
      expect(result.cache.swr).toBe(60);
      expect(result.headers).toEqual({ 'x-a': '1' });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('supports /path/* single-segment wildcard', async () => {
    const dir = await tempProject(`export default defineNuxtConfig({
  routeRules: { '/blog/*': { swr: 60 } },
})`);
    try {
      const one = await explainRenderMode(dir, '/blog/hello');
      expect(one.mode).toBe('swr');
      expect(one.cache.swr).toBe(60);

      const two = await explainRenderMode(dir, '/blog/hello/world');
      expect(two.matchedRules).toHaveLength(0);
      expect(two.mode).toBe('ssr');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('global ssr:false defaults to spa and adds a note', async () => {
    const dir = await tempProject(`export default defineNuxtConfig({ ssr: false })`);
    try {
      const result = await explainRenderMode(dir, '/anything');
      expect(result.mode).toBe('spa');
      expect(result.notes.some((n) => n.includes('ssr: false'))).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('notes non-evaluable expressions without throwing', async () => {
    const dir = await tempProject(`export default defineNuxtConfig({
  routeRules: { '/api/**': { swr: SOME_CONST } },
})`);
    try {
      const result = await explainRenderMode(dir, '/api/users');
      expect(result.notes.some((n) => n.includes('Unresolved expression'))).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('reads nitro.routeRules and merges it over top-level routeRules', async () => {
    const dir = await tempProject(`export default defineNuxtConfig({
  routeRules: { '/api/**': { swr: 3600 } },
  nitro: { routeRules: { '/api/**': { swr: 30, cors: true } } },
})`);
    try {
      const result = await explainRenderMode(dir, '/api/users');
      expect(result.cache.swr).toBe(30);
      expect(result.cors).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
