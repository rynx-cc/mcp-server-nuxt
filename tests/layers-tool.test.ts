import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NuxtProjectContext } from '../src/context.js';
import { registerLayerTools } from '../src/tools/layers.js';
import { registerLayersResource } from '../src/resources/layers-graph.js';

let base: string;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-layers-tool-'));
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

describe('layers tooling', () => {
  it('exposes inspect_layers and the layers resource', async () => {
    await write(path.join(base, 'root/package.json'), JSON.stringify({ name: 'root-app' }));
    await write(
      path.join(base, 'root/nuxt.config.ts'),
      "export default defineNuxtConfig({ extends: ['../layer-a', '../layer-b'] })",
    );
    await write(path.join(base, 'layer-a/package.json'), JSON.stringify({ name: 'layer-a' }));
    await write(path.join(base, 'layer-a/nuxt.config.ts'), 'export default defineNuxtConfig({})');
    await write(path.join(base, 'layer-b/package.json'), JSON.stringify({ name: 'layer-b' }));
    await write(path.join(base, 'layer-b/nuxt.config.ts'), 'export default defineNuxtConfig({})');

    const ctx = new NuxtProjectContext(path.join(base, 'root'));
    const layers = await ctx.layers();
    expect(layers.map((l) => l.name)).toEqual(['root-app', 'layer-b', 'layer-a']);

    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerLayerTools(server, ctx);
    registerLayersResource(server, ctx);

    expect((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools['inspect_layers']).toBeTruthy();
    expect(
      (server as unknown as { _registeredResources: Record<string, unknown> })._registeredResources['nuxt://project/layers'],
    ).toBeTruthy();
  });
});
