import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NuxtProjectContext } from '../src/context.js';
import { registerRouteTools } from '../src/tools/routes.js';
import { registerServerApiTools } from '../src/tools/server-api.js';
import { registerComponentTools } from '../src/tools/components.js';
import { routePathToFile, routePathToNitroFile } from '../src/utils/nuxt-parser.js';

let base: string;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-generators-'));
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
    expect(result.path).toBe(path.join(base, 'pages/users/[id].vue'));
    expect(result.content).toContain("layout: 'default'");
    expect(result.content).toContain("middleware: ['auth']");
  });

  it('scaffold_nitro_api dry-run returns the planned handler', async () => {
    const ctx = new NuxtProjectContext(base);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerServerApiTools(server, ctx);

    const result = await callTool(server, 'scaffold_nitro_api', { path: '/api/hello', method: 'post', zod: true });
    expect(result.written).toBe(false);
    expect(result.path).toBe(path.join(base, 'server/api/hello.post.ts'));
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
    expect(result.path).toBe(path.join(base, 'components/BaseButton.vue'));
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
    expect(await fs.readdir(path.join(base, 'pages')).catch(() => [])).toEqual([]);
  });

  it('refuses to write outside the project', async () => {
    const ctx = new NuxtProjectContext(base, { allowWrites: true });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerRouteTools(server, ctx);
    registerComponentTools(server, ctx);
    registerServerApiTools(server, ctx);

    const outside = path.resolve(base, '..', 'escaped-page.vue');
    const route = await callTool(server, 'add_route', { path: '/../../escaped-page', dryRun: false });
    expect(route.error).toMatch(/outside/i);
    expect(await fs.access(outside).then(() => true).catch(() => false)).toBe(false);

    const component = await callTool(server, 'generate_component', { name: '/tmp/audit-pwned', dryRun: true });
    expect(component.error).toMatch(/outside/i);

    const api = await callTool(server, 'scaffold_nitro_api', { path: '/api/../../../tmp/pwned', method: 'get', dryRun: false });
    expect(api.error).toMatch(/outside/i);
  });

  it('refuses to overwrite an existing page', async () => {
    await fs.mkdir(path.join(base, 'pages'), { recursive: true });
    await fs.writeFile(path.join(base, 'pages/about.vue'), '<template>keep</template>', 'utf8');
    const ctx = new NuxtProjectContext(base, { allowWrites: true });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerRouteTools(server, ctx);

    const result = await callTool(server, 'add_route', { path: '/about', dryRun: false });
    expect(result.written).toBe(false);
    expect(result.exists).toBe(true);
    expect(await fs.readFile(path.join(base, 'pages/about.vue'), 'utf8')).toContain('keep');
  });

  it('refuses to follow a pages symlink out of the project', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-escape-'));
    try {
      await fs.symlink(outside, path.join(base, 'pages'));
      const ctx = new NuxtProjectContext(base, { allowWrites: true });
      const server = new McpServer({ name: 'test', version: '0.0.0' });
      registerRouteTools(server, ctx);

      const result = await callTool(server, 'add_route', { path: '/about', dryRun: false });
      expect(result.error).toMatch(/outside/i);
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('writes a Nuxt 4 page under app/pages', async () => {
    await fs.writeFile(path.join(base, 'package.json'), JSON.stringify({ dependencies: { nuxt: '^4.0.0' } }), 'utf8');
    await fs.mkdir(path.join(base, 'app'), { recursive: true });
    await fs.writeFile(path.join(base, 'app/app.vue'), '<template><NuxtPage /></template>', 'utf8');
    const ctx = new NuxtProjectContext(base, { allowWrites: true });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerRouteTools(server, ctx);

    const result = await callTool(server, 'add_route', { path: '/pricing', dryRun: false });
    expect(result.written).toBe(true);
    expect(result.path).toBe(path.join(base, 'app/pages/pricing.vue'));
    expect(await fs.readFile(path.join(base, 'app/pages/pricing.vue'), 'utf8')).toContain('/pricing');
  });
});
