import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setupServer } from '../src/server.js';
import { explainRoute, matchPattern } from '../src/utils/explain-route.js';
import { listPageRoutes, listServerRoutes } from '../src/utils/nuxt-parser.js';

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'nuxt3-minimal',
);

type Tool = {
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: Array<{ text: string }> }>;
};

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = (server as unknown as { _registeredTools: Record<string, Tool> })._registeredTools[name]!;
  const result = await tool.handler(args, {});
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe('matchPattern', () => {
  it('matches static and dynamic segments', () => {
    expect(matchPattern('/', '/')).toEqual({});
    expect(matchPattern('/users/:id', '/users/42')).toEqual({ id: '42' });
    expect(matchPattern('/users/:id', '/users')).toBeNull();
  });

  it('matches catch-all and optional', () => {
    expect(matchPattern('/blog/:slug(.*)*', '/blog/a/b')).toEqual({ slug: ['a', 'b'] });
    expect(matchPattern('/opt/:id?', '/opt')).toEqual({});
    expect(matchPattern('/opt/:id?', '/opt/9')).toEqual({ id: '9' });
  });
});

describe('explain_route (fixture)', () => {
  it('explains static, dynamic, catch-all, nested, layout false, middleware, fetch, api, not-found', async () => {
    const routes = await listPageRoutes(fixture);
    const serverRoutes = await listServerRoutes(fixture);

    const home = await explainRoute(fixture, '/', routes, serverRoutes);
    expect(home.matched).toBe(true);
    expect(home.page?.file).toMatch(/pages\/index\.vue$/);

    const user = await explainRoute(fixture, '/users/42', routes, serverRoutes);
    expect(user.matched).toBe(true);
    expect(user.page?.params).toEqual({ id: '42' });
    expect(user.page?.pattern).toBe('/users/:id');
    expect(user.parents.some((p) => p.file.includes('pages/users.vue'))).toBe(true);
    expect(user.layout?.name).toBe('default');
    expect(user.layout?.file).toMatch(/layouts\/default\.vue$/);
    expect(user.middleware.some((m) => m.type === 'global' && m.name === 'logger')).toBe(true);
    expect(user.middleware.some((m) => m.type === 'named' && m.name === 'auth')).toBe(true);
    const globalIdx = user.middleware.findIndex((m) => m.type === 'global');
    const namedIdx = user.middleware.findIndex((m) => m.type === 'named');
    expect(globalIdx).toBeGreaterThanOrEqual(0);
    expect(namedIdx).toBeGreaterThan(globalIdx);
    expect(user.dataFetching.some((d) => d.composable === 'useFetch' && d.keyOrUrl === '/api/hello')).toBe(true);
    expect(user.serverRoutes.some((s) => s.url === '/api/hello' && s.file.includes('server/api/hello'))).toBe(true);

    const blog = await explainRoute(fixture, '/blog/hello/world', routes, serverRoutes);
    expect(blog.matched).toBe(true);
    expect(blog.page?.params.slug).toEqual(['hello', 'world']);

    const bare = await explainRoute(fixture, '/bare', routes, serverRoutes);
    expect(bare.matched).toBe(true);
    expect(bare.layout?.name).toBe(false);
    expect(bare.middleware.some((m) => m.type === 'inline')).toBe(true);

    const dash = await explainRoute(fixture, '/dashboard', routes, serverRoutes);
    expect(dash.layout?.name).toBe('admin');
    expect(dash.middleware.some((m) => m.name === 'admin' && m.file?.includes('middleware/admin'))).toBe(true);

    const missing = await explainRoute(fixture, '/nope/missing', routes, serverRoutes);
    expect(missing.matched).toBe(false);
    expect(missing.notes.length).toBeGreaterThan(0);
  });

  it('MCP tool explain_route returns JSON for /users/42', async () => {
    const server = new McpServer({ name: 't', version: '0.0.0' });
    const { watcher } = await setupServer(server, fixture);
    try {
      const result = await callTool(server, 'explain_route', { route: '/users/42' });
      expect(result.matched).toBe(true);
      expect((result.page as { params: { id: string } }).params.id).toBe('42');
      expect(result.error).toBeUndefined();
    } finally {
      watcher.stop();
    }
  });
});
