import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setupServer } from '../src/server.js';

const fixturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

type Tool = {
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: Array<{ text: string }> }>;
};

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = (server as unknown as { _registeredTools: Record<string, Tool> })._registeredTools[name]!;
  const result = await tool.handler(args, {});
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

const READONLY_TOOLS = [
  'get_project_overview',
  'list_routes',
  'get_route',
  'list_components',
  'inspect_component',
  'list_composables',
  'list_server_routes',
  'list_modules',
  'read_config',
  'analyze_project',
  'get_auto_imports',
  'get_type_info',
  'inspect_layers',
  'search_code',
  'analyze_bundle_deps',
] as const;

async function withFixture(rel: string, fn: (server: McpServer, root: string) => Promise<void>) {
  const root = path.join(fixturesRoot, rel);
  const server = new McpServer({ name: 'e2e', version: '0.0.0' });
  const { watcher } = await setupServer(server, root);
  try {
    await fn(server, root);
  } finally {
    watcher.stop();
  }
}

describe('fixture e2e — readonly tools', () => {
  it('nuxt3-minimal: overview and routes resolve', async () => {
    await withFixture('nuxt3-minimal', async (server) => {
      const overview = await callTool(server, 'get_project_overview');
      expect(overview.hasNuxtConfig).toBe(true);
      expect(overview.name).toBe('fixture-nuxt3-minimal');
      expect((overview.counts as { routes: number }).routes).toBeGreaterThanOrEqual(2);
      expect(overview.built).toBe(false);

      const routes = await callTool(server, 'list_routes');
      expect((routes.count as number) >= 2).toBe(true);
      const paths = ((routes.routes as Array<{ path: string }>) ?? []).map((r) => r.path);
      expect(paths).toContain('/');
      expect(paths.some((p) => p.includes(':id'))).toBe(true);

      for (const name of READONLY_TOOLS) {
        const result = await callTool(server, name, name === 'get_route' ? { path: '/' } : name === 'inspect_component' ? { name: 'BaseButton' } : name === 'search_code' ? { query: 'Home' } : {});
        // Type tools may soft-fail without a local nuxt install (auto-gen needs it).
        if (name === 'get_type_info' || name === 'get_auto_imports') {
          expect(JSON.stringify(result)).not.toMatch(/at Object\.|at async /);
          continue;
        }
        expect(result.error).toBeUndefined();
      }
    });
  });

  it('nuxt4-app: discovers app/pages routes', async () => {
    await withFixture('nuxt4-app', async (server) => {
      const overview = await callTool(server, 'get_project_overview');
      expect(overview.hasNuxtConfig).toBe(true);
      expect((overview.directories as string[]).some((d) => d.includes('app'))).toBe(true);

      const routes = await callTool(server, 'list_routes');
      const paths = ((routes.routes as Array<{ path: string }>) ?? []).map((r) => r.path);
      expect(paths).toContain('/');
      expect(paths).toContain('/about');

      const components = await callTool(server, 'list_components');
      expect((components.total as number) >= 1).toBe(true);
    });
  });

  it('with-layers: includes layer components', async () => {
    await withFixture('with-layers', async (server) => {
      const overview = await callTool(server, 'get_project_overview');
      expect(((overview.layers as string[]) ?? []).length).toBeGreaterThanOrEqual(1);

      const components = await callTool(server, 'list_components');
      const names = ((components.components as Array<{ name: string }>) ?? []).map((c) => c.name);
      expect(names).toContain('AppOnly');
      expect(names).toContain('LayerButton');
    });
  });

  it('no-prepare: returns structured prepare hint, does not crash', async () => {
    await withFixture('no-prepare', async (server) => {
      const overview = await callTool(server, 'get_project_overview');
      expect(overview.built).toBe(false);

      const auto = await callTool(server, 'get_auto_imports');
      expect(auto.built).toBe(false);
      expect(String(auto.hint ?? '') + String(auto.error ?? '')).toMatch(/nuxt|auto-generat|prepare/i);

      const analysis = await callTool(server, 'analyze_project');
      expect(analysis.built).toBe(false);
      expect(((analysis.hints as string[]) ?? []).some((h) => /auto-generate|nuxi prepare/i.test(h))).toBe(true);

      for (const name of READONLY_TOOLS) {
        const result = await callTool(server, name, name === 'get_route' ? { path: '/' } : name === 'inspect_component' ? { name: 'Missing' } : name === 'search_code' ? { query: 'unprepared' } : {});
        // Must not throw / return INTERNAL stack dumps
        if (result.error && typeof result.error === 'object') {
          expect((result.error as { message?: string }).message).toBeTruthy();
          expect(JSON.stringify(result)).not.toMatch(/at Object\.|at async /);
        }
      }
    });
  });

  it('monorepo subpackage: overview works when pointed at packages/web', async () => {
    await withFixture('monorepo/packages/web', async (server) => {
      const overview = await callTool(server, 'get_project_overview');
      expect(overview.name).toBe('@fixture/web');
      expect(overview.hasNuxtConfig).toBe(true);
      expect((overview.counts as { routes: number }).routes).toBeGreaterThanOrEqual(1);

      const components = await callTool(server, 'list_components');
      const names = ((components.components as Array<{ name: string }>) ?? []).map((c) => c.name);
      expect(names).toContain('WebBadge');
    });
  });
});
