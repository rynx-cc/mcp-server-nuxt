import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NuxtProjectContext } from '../src/context.js';
import { registerServerApiTools } from '../src/tools/server-api.js';
import {
  listComposables,
  listDirectories,
  listPageRoutes,
  listServerRoutes,
  readTypeInfo,
} from '../src/utils/nuxt-parser.js';
import { listComponents } from '../src/utils/component-scan.js';

let base: string;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-source-layout-'));
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

type Tool = { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: Array<{ text: string }> }> };

async function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
  const tool = (server as unknown as { _registeredTools: Record<string, Tool> })._registeredTools[name]!;
  const result = await tool.handler(args, {});
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe('Nuxt source directories', () => {
  it('scans a Nuxt 4 app/ directory and keeps server routes at the root', async () => {
    const root = path.join(base, 'v4');
    await write(path.join(root, 'package.json'), JSON.stringify({ dependencies: { nuxt: '^4.2.0' } }));
    await write(path.join(root, 'nuxt.config.ts'), 'export default defineNuxtConfig({})\n');
    await write(path.join(root, 'app/pages/index.vue'), '<template><h1>Home</h1></template>');
    await write(path.join(root, 'app/pages/about.vue'), '<template><h1>About</h1></template>');
    await write(path.join(root, 'app/components/base/BaseButton.vue'), '<template><button /></template>');
    await write(
      path.join(root, 'app/composables/useAuth.ts'),
      'export function useAuth(id: string): string { return id }\nexport function useAuthUser() {}\n',
    );
    await write(path.join(root, 'server/api/hello.get.ts'), 'export default defineEventHandler(() => ({ ok: true }))\n');

    expect((await listPageRoutes(root)).map((route) => route.path).sort()).toEqual(['/', '/about']);
    expect((await listPageRoutes(root)).find((route) => route.path === '/')?.nested).toBe(false);
    expect((await listComponents(root)).map((component) => component.name)).toEqual(['BaseButton']);
    expect((await listComposables(root)).map((item) => item.name).sort()).toEqual(['useAuth', 'useAuthUser']);
    expect((await listComposables(root)).find((item) => item.name === 'useAuth')).toMatchObject({
      parameters: 'id: string',
      returnType: 'string',
      autoImported: true,
      file: 'app/composables/useAuth.ts',
    });
    expect(await listDirectories(root)).toEqual(
      expect.arrayContaining(['app/pages', 'app/components', 'app/composables', 'server']),
    );
    expect((await listServerRoutes(root)).map((route) => route.path)).toEqual(['/api/hello']);
  });

  it('keeps a Nuxt 3 project at the root when app/ only holds router.options', async () => {
    const root = path.join(base, 'v3');
    await write(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { nuxt: '^3.16.0' } }));
    await write(path.join(root, 'pages/index.vue'), '<template />');
    await write(path.join(root, 'pages/users.vue'), '<template />');
    await write(path.join(root, 'pages/users/[id].vue'), '<template />');
    await write(path.join(root, 'app/router.options.ts'), 'export default {}\n');
    await write(path.join(root, 'app/pages/extra.vue'), '<template />');

    const routes = await listPageRoutes(root);
    expect(routes.map((route) => route.path).sort()).toEqual(['/', '/users', '/users/:id']);
    expect(routes.some((route) => route.file.includes('app/pages'))).toBe(false);
    expect(routes.find((route) => route.path === '/')?.nested).toBe(false);
    expect(routes.find((route) => route.file === 'pages/users.vue')).toMatchObject({
      nested: true,
      children: ['/users/:id'],
    });
    expect(routes.find((route) => route.path === '/users/:id')?.nested).toBe(false);
  });

  it('uses app/ for Nuxt 3 when compatibilityVersion is 4', async () => {
    const root = path.join(base, 'compat');
    await write(path.join(root, 'package.json'), JSON.stringify({ dependencies: { nuxt: '~3.17.0' } }));
    await write(
      path.join(root, 'nuxt.config.ts'),
      'export default defineNuxtConfig({ future: { compatibilityVersion: 4 } })\n',
    );
    await write(path.join(root, 'app/pages/pricing.vue'), '<template />');
    await write(path.join(root, 'pages/ignored.vue'), '<template />');

    const routes = await listPageRoutes(root);
    expect(routes.map((route) => route.file)).toEqual(['app/pages/pricing.vue']);
  });

  it('honors an explicit srcDir and dir.pages', async () => {
    const root = path.join(base, 'custom');
    await write(path.join(root, 'package.json'), JSON.stringify({ dependencies: { nuxt: '^3.14.0' } }));
    await write(
      path.join(root, 'nuxt.config.ts'),
      "export default defineNuxtConfig({ srcDir: 'src', dir: { pages: 'views' } })\n",
    );
    await write(path.join(root, 'src/views/hello.vue'), '<template />');

    expect((await listPageRoutes(root)).map((route) => route.file)).toEqual(['src/views/hello.vue']);
  });

  it('scans server routes from layers and includes server/routes in the api filter', async () => {
    const root = path.join(base, 'layered');
    const layer = path.join(base, 'layer');
    await write(path.join(root, 'server/api/local.get.ts'), 'export default defineEventHandler(() => ({}))\n');
    await write(path.join(root, 'server/routes/health.get.ts'), 'export default defineEventHandler(() => ({}))\n');
    await write(path.join(layer, 'server/api/from-layer.get.ts'), 'export default defineEventHandler(() => ({}))\n');

    const routes = await listServerRoutes(root, [{ cwd: layer, name: 'layer' }]);
    expect(routes.map((route) => route.path).sort()).toEqual(['/api/from-layer', '/api/local', '/health']);
    expect(routes.find((route) => route.path === '/api/from-layer')?.layer).toBe('layer');

    const ctx = new NuxtProjectContext(root);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerServerApiTools(server, ctx);
    const filtered = await callTool(server, 'list_server_routes', { type: 'api' });
    const listed = filtered.routes as Array<{ path: string }>;
    expect(listed.map((route) => route.path).sort()).toEqual(['/api/local', '/health']);
  });

  it('lists .nuxt/types declaration files', async () => {
    const root = path.join(base, 'types');
    await write(path.join(root, '.nuxt/imports.d.ts'), 'export {}\n');
    await write(path.join(root, '.nuxt/types/imports.d.ts'), 'export {}\n');
    await write(path.join(root, '.nuxt/types/nitro.d.ts'), 'export {}\n');

    const info = await readTypeInfo(root);
    expect(info.importsDts).toContain('export');
    expect(info.typesDir).toEqual(['.nuxt/types/imports.d.ts', '.nuxt/types/nitro.d.ts']);
  });

  it('does not treat a declaration file as a composable', async () => {
    const root = path.join(base, 'dts');
    await write(path.join(root, 'composables/useReal.ts'), 'export function useReal() {}\n');
    await write(path.join(root, 'composables/types.d.ts'), 'export function useFake() {}\n');

    expect((await listComposables(root)).map((item) => item.name)).toEqual(['useReal']);
  });
});
