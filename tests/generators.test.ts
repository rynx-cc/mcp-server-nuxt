import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NuxtProjectContext } from '../src/context.js';
import { registerRouteTools } from '../src/tools/routes.js';
import { registerServerApiTools } from '../src/tools/server-api.js';
import { registerComponentTools } from '../src/tools/components.js';
import { registerComposableTools } from '../src/tools/composables.js';
import { registerDiagnosticTools } from '../src/tools/diagnostics.js';
import { routePathToFile, routePathToNitroFile } from '../src/utils/nuxt-parser.js';

let base: string;

function samePath(actual: unknown, expected: string): void {
  // macOS temp dirs may appear as /var/... or /private/var/...
  const norm = (p: string) => path.resolve(p).replace(/^\/private(\/var\/)/, '$1');
  expect(norm(String(actual))).toBe(norm(expected));
}

beforeEach(async () => {
  base = realpathSync(await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-generators-')));
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe('routePathToFile', () => {
  it('maps static, dynamic, optional, catch-all, and index routes', () => {
    expect(routePathToFile('/users/:id')).toBe('pages/users/[id].vue');
    expect(routePathToFile('/users/:id?')).toBe('pages/users/[[id]].vue');
    expect(routePathToFile('/docs/[...slug]')).toBe('pages/docs/[...slug].vue');
    expect(routePathToFile('/')).toBe('pages/index.vue');
    expect(routePathToFile('/about')).toBe('pages/about.vue');
  });
});

describe('routePathToNitroFile', () => {
  it('maps api paths and methods to nitro handler files', () => {
    expect(routePathToNitroFile('/api/hello', 'get')).toBe('server/api/hello.get.ts');
    expect(routePathToNitroFile('/api/hello')).toBe('server/api/hello.ts');
    expect(routePathToNitroFile('/api/users/:id', 'post')).toBe('server/api/users/[id].post.ts');
    expect(routePathToNitroFile('/api', 'get')).toBe('server/api/index.get.ts');
  });
});

type Tool = { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: Array<{ text: string }> }> };

async function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
  const tool = (server as unknown as { _registeredTools: Record<string, Tool> })._registeredTools[name]!;
  const result = await tool.handler(args, {});
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe('generator tools', () => {
  it('add_route dry-run returns the planned page', async () => {
    const ctx = new NuxtProjectContext(base);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerRouteTools(server, ctx);

    const result = await callTool(server, 'add_route', { path: '/users/:id', layout: 'default', middleware: ['auth'] });
    expect(result.written).toBe(false);
    samePath(result.path, path.join(base, 'pages/users/[id].vue'));
    expect(result.content).toContain("layout: 'default'");
    expect(result.content).toContain("middleware: ['auth']");
  });

  it('scaffold_nitro_api dry-run returns the planned handler', async () => {
    const ctx = new NuxtProjectContext(base);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerServerApiTools(server, ctx);

    const result = await callTool(server, 'scaffold_nitro_api', { path: '/api/hello', method: 'post', zod: true });
    expect(result.written).toBe(false);
    samePath(result.path, path.join(base, 'server/api/hello.post.ts'));
    expect(result.content).toContain('defineEventHandler');
    expect(result.content).toContain('readValidatedBody');
  });

  it('generate_component dry-run returns the planned SFC', async () => {
    const ctx = new NuxtProjectContext(base);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerComponentTools(server, ctx);

    const result = await callTool(server, 'generate_component', {
      name: 'BaseButton',
      props: { label: 'string' },
      emits: ['click'],
      slots: ['icon'],
    });
    expect(result.written).toBe(false);
    samePath(result.path, path.join(base, 'components/BaseButton.vue'));
    expect(result.content).toContain('label: string');
    expect(result.content).toContain('click: []');
    expect(result.content).toContain('<slot name="icon" />');
  });

  it('refuses real writes when the guard disallows them', async () => {
    const ctx = new NuxtProjectContext(base); // allowWrites defaults to false
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerRouteTools(server, ctx);

    const result = await callTool(server, 'add_route', { path: '/about', dryRun: false });
    expect(result.ok).toBe(false);
    expect((result.error as { code?: string })?.code).toBe('UNAUTHORIZED');
    expect(await fs.readdir(path.join(base, 'pages')).catch(() => [])).toEqual([]);
  });

  it('generate_composable dry-run returns the planned file', async () => {
    const ctx = new NuxtProjectContext(base);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerComposableTools(server, ctx);

    const result = await callTool(server, 'generate_composable', { name: 'counter', returns: '{ count: number }' });
    expect(result.written).toBe(false);
    samePath(result.path, path.join(base, 'composables/useCounter.ts'));
    expect(result.content).toContain('export function useCounter()');
    expect(result.content).toContain('{ count: number }');
  });

  it('analyze_project returns structured health info without .nuxt', async () => {
    await fs.writeFile(path.join(base, 'nuxt.config.ts'), 'export default defineNuxtConfig({})\n');
    await fs.writeFile(path.join(base, 'package.json'), JSON.stringify({ name: 'fixture-analyze', dependencies: { nuxt: '3.14.0' } }));
    await fs.mkdir(path.join(base, 'pages'), { recursive: true });
    await fs.writeFile(path.join(base, 'pages/index.vue'), '<template><div>hi</div></template>\n');

    const ctx = new NuxtProjectContext(base);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerDiagnosticTools(server, ctx);

    const result = await callTool(server, 'analyze_project', { limit: 10 });
    expect(result.built).toBe(false);
    expect(Array.isArray(result.hints)).toBe(true);
    expect((result.hints as string[]).some((h) => h.includes('nuxi prepare'))).toBe(true);
    expect(result.name).toBe('fixture-analyze');
  });
});
