import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseImportsDts, readAutoImports } from '../src/utils/auto-imports.js';

let base: string;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-autoimports-'));
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe('parseImportsDts', () => {
  it('parses export { ... } from lines', () => {
    const src = "export { ref, computed } from 'vue'\nexport { useFoo as useBar } from '/abs/composables/useFoo'";
    const imports = parseImportsDts(src);
    expect(imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'ref', source: 'vue', kind: 'function' }),
        expect.objectContaining({ name: 'computed', source: 'vue', kind: 'function' }),
        expect.objectContaining({ name: 'useBar', source: '/abs/composables/useFoo' }),
      ]),
    );
  });

  it('parses default component exports', () => {
    const src = "export { default as BaseButton } from '/abs/components/BaseButton.vue'";
    const imports = parseImportsDts(src);
    expect(imports).toEqual([
      expect.objectContaining({ name: 'BaseButton', source: '/abs/components/BaseButton.vue', kind: 'component' }),
    ]);
  });

  it('parses typeof import(...) const declarations', () => {
    const src = "declare global {\n  const useFoo: typeof import('/abs/composables/useFoo')['useFoo']\n}";
    const imports = parseImportsDts(src);
    expect(imports).toEqual([
      expect.objectContaining({
        name: 'useFoo',
        source: '/abs/composables/useFoo',
        kind: 'function',
        signature: "typeof import('/abs/composables/useFoo')['useFoo']",
      }),
    ]);
  });

  it('deduplicates repeated names', () => {
    const src = "export { ref } from 'vue'\nexport { ref } from 'vue'";
    expect(parseImportsDts(src)).toHaveLength(1);
  });
});

describe('readAutoImports', () => {
  it('returns built:false when .nuxt/imports.d.ts is missing', async () => {
    const result = await readAutoImports(path.join(base, 'no-nuxt'));
    expect(result).toEqual({ built: false, imports: [] });
  });

  it('reads a real imports.d.ts file', async () => {
    const nuxtDir = path.join(base, '.nuxt');
    await fs.mkdir(nuxtDir, { recursive: true });
    await fs.writeFile(path.join(nuxtDir, 'imports.d.ts'), "export { ref } from 'vue'", 'utf8');

    const result = await readAutoImports(base);
    expect(result.built).toBe(true);
    expect(result.imports).toEqual([expect.objectContaining({ name: 'ref', source: 'vue' })]);
  });
});
