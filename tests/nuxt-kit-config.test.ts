/**
 * `loadNuxtConfig` must call the Kit installed in the target project.
 * These fixtures ship a minimal `@nuxt/kit` (Nuxt 3 and Nuxt 4) so the
 * resolution order is proven without downloading the full Nuxt package.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadNuxtConfig } from '../src/utils/config-reader.js';

let base: string;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-kit-config-'));
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

async function installFixtureKit(root: string, nuxtVersion: string, kitSource: string) {
  const kitDir = path.join(root, 'node_modules', '@nuxt', 'kit');
  await write(
    path.join(kitDir, 'package.json'),
    JSON.stringify({
      name: '@nuxt/kit',
      version: nuxtVersion,
      type: 'module',
      exports: { '.': './index.js' },
    }),
  );
  await write(path.join(kitDir, 'index.js'), kitSource);
  await write(
    path.join(root, 'node_modules', 'nuxt', 'package.json'),
    JSON.stringify({ name: 'nuxt', version: nuxtVersion }),
  );
}

const kitModule = `
export async function loadNuxtConfig(opts = {}) {
  const root = typeof opts.cwd === 'string' ? opts.cwd : opts.rootDir;
  if (typeof root !== 'string' || !root) throw new Error('root missing');
  const major = globalThis.__FIXTURE_NUXT_MAJOR;
  const srcDir = major === 4 ? root.replace(/[/\\\\]+$/, '') + '/app' : root;
  return {
    receivedCwd: opts.cwd ?? null,
    receivedRootDir: opts.rootDir ?? null,
    srcDir,
    compatibilityVersion: major,
    modules: [major === 4 ? '@fixture/nuxt4-kit' : '@fixture/nuxt3-kit'],
    runtimeConfig: { public: { apiBase: major === 4 ? 'https://nuxt4.example' : 'https://nuxt3.example' } },
  };
}
`;

describe('loadNuxtConfig kit resolution', () => {
  it('loads a minimal Nuxt 3 project with that project Kit', async () => {
    const root = path.join(base, 'nuxt3');
    await write(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'fixture-nuxt3', private: true, dependencies: { nuxt: '^3.16.0' } }),
    );
    await write(
      path.join(root, 'nuxt.config.ts'),
      [
        'export default defineNuxtConfig({',
        '  ssr: true,',
        "  runtimeConfig: { public: { apiBase: process.env.API_BASE || 'from-source' } },",
        '})',
        '',
      ].join('\n'),
    );
    await write(path.join(root, 'pages', 'index.vue'), '<template><h1>Home</h1></template>\n');
    await installFixtureKit(root, '3.16.2', `globalThis.__FIXTURE_NUXT_MAJOR = 3;\n${kitModule}`);

    const loaded = await loadNuxtConfig(root);
    expect(loaded.sourceKind).toBe('resolved');
    expect(loaded.value['receivedCwd']).toBe(root);
    expect(loaded.value['receivedRootDir']).toBe(root);
    expect(loaded.value['srcDir']).toBe(root);
    expect(loaded.value['compatibilityVersion']).toBe(3);
    expect(loaded.value['modules']).toEqual(['@fixture/nuxt3-kit']);
    expect(loaded.value['runtimeConfig']).toEqual({ public: { apiBase: 'https://nuxt3.example' } });
  });

  it('loads a minimal Nuxt 4 project (app/ srcDir) with that project Kit', async () => {
    const root = path.join(base, 'nuxt4');
    await write(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'fixture-nuxt4', private: true, dependencies: { nuxt: '^4.2.0' } }),
    );
    await write(
      path.join(root, 'nuxt.config.ts'),
      [
        'export default defineNuxtConfig({',
        "  srcDir: 'app',",
        '  future: { compatibilityVersion: 4 },',
        "  runtimeConfig: { public: { apiBase: process.env.API_BASE || 'from-source' } },",
        '})',
        '',
      ].join('\n'),
    );
    await write(path.join(root, 'app', 'pages', 'index.vue'), '<template><h1>Home</h1></template>\n');
    await installFixtureKit(root, '4.2.0', `globalThis.__FIXTURE_NUXT_MAJOR = 4;\n${kitModule}`);

    const loaded = await loadNuxtConfig(root);
    expect(loaded.sourceKind).toBe('resolved');
    expect(loaded.value['receivedCwd']).toBe(root);
    expect(loaded.value['srcDir']).toBe(path.join(root, 'app'));
    expect(loaded.value['compatibilityVersion']).toBe(4);
    expect(loaded.value['modules']).toEqual(['@fixture/nuxt4-kit']);
    expect(loaded.value['runtimeConfig']).toEqual({ public: { apiBase: 'https://nuxt4.example' } });
  });

  it('logs the Kit error and falls back to the source parser when Kit throws', async () => {
    const root = path.join(base, 'kit-throws');
    await write(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'fixture-kit-throws', private: true, dependencies: { nuxt: '^4.2.0' } }),
    );
    await write(
      path.join(root, 'nuxt.config.ts'),
      [
        'export default defineNuxtConfig({',
        '  ssr: false,',
        "  modules: ['from-source'],",
        '})',
        '',
      ].join('\n'),
    );
    await installFixtureKit(
      root,
      '4.2.0',
      "export async function loadNuxtConfig() { throw new Error('kit schema mismatch for this fixture'); }\n",
    );

    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map((part) => String(part)).join(' '));
    });
    try {
      const loaded = await loadNuxtConfig(root);
      expect(loaded.sourceKind).toBe('parsed');
      expect(loaded.value['ssr']).toBe(false);
      expect(loaded.value['modules']).toEqual(['from-source']);
      expect(loaded.error).toBeUndefined();
      expect(errors.join('\n')).toContain('kit schema mismatch for this fixture');
      expect(errors.join('\n')).toContain('Falling back to the source parser');
    } finally {
      spy.mockRestore();
    }
  });
});
