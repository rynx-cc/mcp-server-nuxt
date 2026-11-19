import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NuxtProjectContext } from '../src/context.js';

let base: string;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-resolved-layers-'));
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

const kitModule = `
import path from 'node:path';
export async function loadNuxtConfig(opts = {}) {
  const root = opts.cwd;
  const layer = (dir) => ({ cwd: path.join(root, dir), configFile: path.join(root, dir, 'nuxt.config.ts'), config: {} });
  return {
    rootDir: root,
    srcDir: root,
    _layers: [
      { cwd: root, configFile: 'nuxt.config', config: { extends: ['./ext/a', './ext/b'] } },
      layer('layers/base'),
      layer('ext/a'),
      layer('ext/c'),
      layer('ext/b'),
    ],
  };
}
`;

describe('layers from a Kit-resolved config', () => {
  it('uses Nuxt _layers for inspect_layers and layer routes', async () => {
    const root = path.join(base, 'app');
    await write(path.join(root, 'package.json'), JSON.stringify({ name: 'app', private: true }));
    await write(path.join(root, 'nuxt.config.ts'), "export default defineNuxtConfig({ extends: ['./ext/a', './ext/b'] })\n");
    await write(path.join(root, 'pages/index.vue'), '<template><div /></template>\n');
    for (const dir of ['layers/base', 'ext/b', 'ext/c']) {
      await write(path.join(root, dir, 'nuxt.config.ts'), 'export default defineNuxtConfig({})\n');
    }
    await write(path.join(root, 'ext/a/nuxt.config.ts'), "export default defineNuxtConfig({ extends: '../c' })\n");
    await write(path.join(root, 'layers/base/pages/from-layer.vue'), '<template><div /></template>\n');
    await write(path.join(root, 'ext/a/pages/from-a.vue'), '<template><div /></template>\n');
    await write(path.join(root, 'node_modules/nuxt/package.json'), JSON.stringify({ name: 'nuxt', version: '4.6.4' }));
    await write(
      path.join(root, 'node_modules/@nuxt/kit/package.json'),
      JSON.stringify({ name: '@nuxt/kit', version: '4.6.4', type: 'module', exports: { '.': './index.js' } }),
    );
    await write(path.join(root, 'node_modules/@nuxt/kit/index.js'), kitModule);

    const ctx = new NuxtProjectContext(root);
    expect((await ctx.config()).sourceKind).toBe('resolved');

    const layers = await ctx.layers();
    expect(layers.map((l) => [path.relative(root, l.cwd) || '.', l.priority])).toEqual([
      ['.', 0],
      ['layers/base', 1],
      ['ext/a', 2],
      ['ext/c', 3],
      ['ext/b', 4],
    ]);
    expect(layers[0]!.configFile).toBe(path.join(root, 'nuxt.config.ts'));
    expect(layers[0]!.extends).toEqual(['./ext/a', './ext/b']);
    expect(layers[0]!.children.map((l) => l.name)).toEqual(['a', 'b']);
    expect(layers[2]!.extends).toEqual(['../c']);
    expect(layers[2]!.children.map((l) => l.name)).toEqual(['c']);

    const { routes } = await ctx.snapshot();
    expect(routes.map((r) => r.path)).toEqual(['/', '/from-a', '/from-layer']);
  });

  it('links a layer package that node_modules symlinks to', async () => {
    const root = path.join(base, 'app');
    const pkg = path.join(base, 'packages/ui-layer');
    await write(path.join(root, 'package.json'), JSON.stringify({ name: 'app', private: true }));
    await write(path.join(root, 'nuxt.config.ts'), "export default defineNuxtConfig({ extends: ['ui-layer'] })\n");
    await write(path.join(pkg, 'package.json'), JSON.stringify({ name: 'ui-layer' }));
    await write(path.join(pkg, 'nuxt.config.ts'), 'export default defineNuxtConfig({})\n');
    await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
    await fs.symlink(pkg, path.join(root, 'node_modules/ui-layer'), 'dir');
    await write(path.join(root, 'node_modules/nuxt/package.json'), JSON.stringify({ name: 'nuxt', version: '4.6.4' }));
    await write(
      path.join(root, 'node_modules/@nuxt/kit/package.json'),
      JSON.stringify({ name: '@nuxt/kit', version: '4.6.4', type: 'module', exports: { '.': './index.js' } }),
    );
    await write(
      path.join(root, 'node_modules/@nuxt/kit/index.js'),
      `export async function loadNuxtConfig(opts = {}) {
  return {
    rootDir: opts.cwd,
    _layers: [
      { cwd: opts.cwd, config: { extends: ['ui-layer'] } },
      { cwd: ${JSON.stringify(pkg)}, config: {} },
    ],
  };
}
`,
    );

    const layers = await new NuxtProjectContext(root).layers();
    expect(layers.map((l) => l.name)).toEqual(['app', 'ui-layer']);
    expect(layers[0]!.children.map((l) => l.name)).toEqual(['ui-layer']);
  });
});
