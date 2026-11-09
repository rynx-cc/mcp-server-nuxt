import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeBundleDeps } from '../src/utils/nuxt-parser.js';

let base: string;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-bundle-deps-'));
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe('analyzeBundleDeps', () => {
  it('classifies nuxt modules vs runtime/dev deps and warns when missing', async () => {
    await fs.writeFile(
      path.join(base, 'package.json'),
      JSON.stringify({
        name: 'app',
        dependencies: { axios: '^1.0.0' },
        devDependencies: { '@nuxt/content': '^2.0.0' },
      }),
      'utf8',
    );

    const { packages, warnings } = await analyzeBundleDeps(base);
    const content = packages.find((p) => p.name === '@nuxt/content');
    const axios = packages.find((p) => p.name === 'axios');
    expect(content).toMatchObject({ kind: 'nuxt-module', version: '^2.0.0' });
    expect(axios).toMatchObject({ kind: 'runtime', version: '^1.0.0' });
    expect(warnings).toContain('Nuxt module "@nuxt/content" is declared but not installed in node_modules.');
  });

  it('does not warn when the module is installed', async () => {
    await fs.writeFile(
      path.join(base, 'package.json'),
      JSON.stringify({ devDependencies: { '@nuxt/content': '^2.0.0' } }),
      'utf8',
    );
    await fs.mkdir(path.join(base, 'node_modules/@nuxt/content'), { recursive: true });
    await fs.writeFile(path.join(base, 'node_modules/@nuxt/content/package.json'), '{}', 'utf8');

    const { warnings } = await analyzeBundleDeps(base);
    expect(warnings).toHaveLength(0);
  });

  it('returns empty results when package.json is missing', async () => {
    await expect(analyzeBundleDeps(base)).resolves.toEqual({ packages: [], warnings: [] });
  });
});
