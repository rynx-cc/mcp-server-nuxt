import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveLayers } from '../src/utils/layers.js';

let base: string;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-layers-'));
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

describe('resolveLayers', () => {
  it('resolves extends in priority order (project > later extends > earlier extends)', async () => {
    await write(path.join(base, 'root/package.json'), JSON.stringify({ name: 'root-app' }));
    await write(
      path.join(base, 'root/nuxt.config.ts'),
      "export default defineNuxtConfig({ extends: ['../layer-a', '../layer-b'] })",
    );
    await write(path.join(base, 'layer-a/package.json'), JSON.stringify({ name: 'layer-a' }));
    await write(path.join(base, 'layer-a/nuxt.config.ts'), 'export default defineNuxtConfig({})');
    await write(path.join(base, 'layer-b/package.json'), JSON.stringify({ name: 'layer-b' }));
    await write(path.join(base, 'layer-b/nuxt.config.ts'), 'export default defineNuxtConfig({})');

    const root = path.join(base, 'root');
    const layers = await resolveLayers(root, ['../layer-a', '../layer-b']);

    expect(layers).toHaveLength(3);
    expect(layers[0]).toMatchObject({ cwd: root, name: 'root-app', priority: 0 });
    expect(layers[1]).toMatchObject({ name: 'layer-b', priority: 1 });
    expect(layers[2]).toMatchObject({ name: 'layer-a', priority: 2 });
    expect(layers[0]!.children).toHaveLength(2);
  });

  it('resolves nested extends and assigns unique priorities', async () => {
    await write(path.join(base, 'root/package.json'), JSON.stringify({ name: 'root-app' }));
    await write(
      path.join(base, 'root/nuxt.config.ts'),
      "export default defineNuxtConfig({ extends: ['../layer-a', '../layer-b'] })",
    );
    await write(path.join(base, 'layer-a/package.json'), JSON.stringify({ name: 'layer-a' }));
    await write(
      path.join(base, 'layer-a/nuxt.config.ts'),
      "export default defineNuxtConfig({ extends: ['../layer-c'] })",
    );
    await write(path.join(base, 'layer-b/package.json'), JSON.stringify({ name: 'layer-b' }));
    await write(path.join(base, 'layer-b/nuxt.config.ts'), 'export default defineNuxtConfig({})');
    await write(path.join(base, 'layer-c/package.json'), JSON.stringify({ name: 'layer-c' }));
    await write(path.join(base, 'layer-c/nuxt.config.ts'), 'export default defineNuxtConfig({})');

    const layers = await resolveLayers(path.join(base, 'root'), ['../layer-a', '../layer-b']);

    const names = layers.map((l) => l.name);
    expect(names).toEqual(['root-app', 'layer-b', 'layer-a', 'layer-c']);
    const priorities = layers.map((l) => l.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
    expect(priorities).toEqual([0, 1, 2, 3]);
  });

  it('returns only the root when there are no extends', async () => {
    await write(path.join(base, 'root/package.json'), JSON.stringify({ name: 'root-app' }));
    await write(path.join(base, 'root/nuxt.config.ts'), 'export default defineNuxtConfig({})');

    const layers = await resolveLayers(path.join(base, 'root'), []);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.name).toBe('root-app');
    expect(layers[0]!.priority).toBe(0);
  });

  it('deduplicates cyclic extends and falls back to dir basename', async () => {
    await write(path.join(base, 'root/nuxt.config.ts'), "export default defineNuxtConfig({ extends: ['./self-layer'] })");
    await write(path.join(base, 'self-layer/nuxt.config.ts'), "export default defineNuxtConfig({ extends: ['./nested'] })");
    // No package.json for self-layer -> falls back to basename.

    const layers = await resolveLayers(path.join(base, 'root'), ['./self-layer']);
    expect(layers.map((l) => l.name)).toEqual([path.basename(path.join(base, 'root')), 'self-layer']);
  });
});
