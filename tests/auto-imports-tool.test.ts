import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NuxtProjectContext } from '../src/context.js';
import { registerComposableTools } from '../src/tools/composables.js';
import { registerAutoImportsResource } from '../src/resources/auto-imports.js';

let base: string;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-autoimports-tool-'));
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe('auto-imports tooling', () => {
  it('exposes get_auto_imports and the auto-imports/types resources', async () => {
    const nuxtDir = path.join(base, '.nuxt');
    await fs.mkdir(nuxtDir, { recursive: true });
    await fs.writeFile(path.join(nuxtDir, 'imports.d.ts'), "export { ref } from 'vue'", 'utf8');

    const ctx = new NuxtProjectContext(base);
    const { built, imports } = await ctx.autoImports();
    expect(built).toBe(true);
    expect(imports).toEqual([expect.objectContaining({ name: 'ref', source: 'vue' })]);

    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerComposableTools(server, ctx);
    registerAutoImportsResource(server, ctx);

    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    const resources = (server as unknown as { _registeredResources: Record<string, unknown> })._registeredResources;
    expect(tools['get_auto_imports']).toBeTruthy();
    expect(resources['nuxt://project/auto-imports']).toBeTruthy();
    expect(resources['nuxt://project/types']).toBeTruthy();
  });
});
