import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NuxtProjectContext } from '../src/context.js';
import { registerAllResources } from '../src/resources/index.js';

let base: string;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-resources-'));
  await fs.mkdir(path.join(base, 'pages'), { recursive: true });
  await fs.writeFile(path.join(base, 'pages/index.vue'), '<template><h1>Home</h1></template>', 'utf8');
  await fs.writeFile(path.join(base, 'nuxt.config.ts'), 'export default defineNuxtConfig({ ssr: true })', 'utf8');
  await fs.mkdir(path.join(base, '.nuxt'), { recursive: true });
  await fs.writeFile(path.join(base, '.nuxt/imports.d.ts'), "export { ref } from 'vue'", 'utf8');
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

type Resource = { readCallback: (uri: URL, extra?: unknown) => Promise<{ contents: Array<{ text: string }> }> };

describe('nuxt:// resources', () => {
  it('registers all project resources', async () => {
    const ctx = new NuxtProjectContext(base);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerAllResources(server, ctx);

    const resources = (server as unknown as { _registeredResources: Record<string, unknown> })._registeredResources;
    const uris = Object.keys(resources);
    expect(uris).toEqual(
      expect.arrayContaining([
        'nuxt://project/overview',
        'nuxt://project/routes',
        'nuxt://project/config',
        'nuxt://project/modules',
        'nuxt://project/layers',
        'nuxt://project/auto-imports',
        'nuxt://project/types',
      ]),
    );
  });

  it('reads the route map as JSON containing route paths', async () => {
    const ctx = new NuxtProjectContext(base);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerAllResources(server, ctx);

    const routeResource = (server as unknown as { _registeredResources: Record<string, Resource> })._registeredResources[
      'nuxt://project/routes'
    ]!;
    const result = await routeResource.readCallback(new URL('nuxt://project/routes'), {});
    const payload = JSON.parse(result.contents[0]!.text);
    expect(payload.count).toBe(1);
    expect(payload.routes[0].path).toBe('/');
  });

  it('reads the config resource with sourceKind', async () => {
    const ctx = new NuxtProjectContext(base);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerAllResources(server, ctx);

    const configResource = (server as unknown as { _registeredResources: Record<string, Resource> })._registeredResources[
      'nuxt://project/config'
    ]!;
    const result = await configResource.readCallback(new URL('nuxt://project/config'), {});
    const payload = JSON.parse(result.contents[0]!.text);
    expect(payload.configFile).toBe(path.join(base, 'nuxt.config.ts'));
    expect(payload.sourceKind).toBe('parsed');
  });
});
