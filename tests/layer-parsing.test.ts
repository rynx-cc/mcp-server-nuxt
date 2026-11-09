import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listComponents, listComposables, listPageRoutes } from '../src/utils/nuxt-parser.js';

let base: string;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-layer-parsing-'));
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

describe('layer-aware listing', () => {
  it('lists components from the project and an external layer with layer tags', async () => {
    await write(path.join(base, 'root/components/Local.vue'), '<template><div /></template>');
    await write(path.join(base, 'layer-a/components/LayerButton.vue'), '<template><button /></template>');

    const components = await listComponents(path.join(base, 'root'), [
      { cwd: path.join(base, 'layer-a'), name: 'layer-a' },
    ]);

    expect(components).toHaveLength(2);
    const layerBtn = components.find((c) => c.name === 'LayerButton');
    const local = components.find((c) => c.name === 'Local');
    expect(layerBtn).toMatchObject({ layer: 'layer-a', absolutePath: path.join(base, 'layer-a/components/LayerButton.vue') });
    expect(local).toMatchObject({ layer: undefined });
  });

  it('lists routes from layers with layer tags', async () => {
    await write(path.join(base, 'root/pages/index.vue'), '<template><h1>Home</h1></template>');
    await write(path.join(base, 'layer-a/pages/about.vue'), '<template><h1>About</h1></template>');

    const routes = await listPageRoutes(path.join(base, 'root'), [
      { cwd: path.join(base, 'layer-a'), name: 'layer-a' },
    ]);

    expect(routes.map((r) => r.path)).toEqual(['/', '/about']);
    expect(routes.find((r) => r.path === '/about')).toMatchObject({ layer: 'layer-a' });
    expect(routes.find((r) => r.path === '/')).toMatchObject({ layer: undefined });
  });

  it('lists composables from layers with layer tags', async () => {
    await write(path.join(base, 'root/composables/useLocal.ts'), 'export function useLocal() {}');
    await write(path.join(base, 'layer-a/composables/useLayer.ts'), 'export function useLayer() {}');

    const composables = await listComposables(path.join(base, 'root'), [
      { cwd: path.join(base, 'layer-a'), name: 'layer-a' },
    ]);

    expect(composables.map((c) => c.name).sort()).toEqual(['useLayer', 'useLocal']);
    expect(composables.find((c) => c.name === 'useLayer')).toMatchObject({ layer: 'layer-a' });
  });
});
