/**
 * Node 18 leaves `import.meta.dirname` undefined. Nuxt's unplugin build calls
 * `path.resolve` on it at import time. The loader rewrites those reads.
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { node18ImportMetaLoaderSource } from '../src/utils/node18-import-meta.js';

describe('import.meta.dirname loader', () => {
  it('rewrites code reads, keeps string literals, and resolves dirname on this Node', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mcp-node18-meta-'));
    const loaderFile = path.join(dir, 'loader.mjs');
    const probeFile = path.join(dir, 'probe.mjs');
    const runnerFile = path.join(dir, 'runner.mjs');
    await writeFile(loaderFile, node18ImportMetaLoaderSource(), 'utf8');
    await writeFile(
      probeFile,
      [
        "import { resolve } from 'node:path';",
        'export const resolved = resolve(import.meta.dirname, "probe.mjs");',
        'export const named = import.meta.filename;',
        'export const hint = "import.meta.dirname";',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      runnerFile,
      [
        "import { register } from 'node:module';",
        "import { pathToFileURL } from 'node:url';",
        "import { realpathSync } from 'node:fs';",
        'const loaderUrl = pathToFileURL(process.argv[2]).href;',
        'const probe = process.argv[3];',
        'const same = (a, b) => realpathSync(a) === realpathSync(b);',
        'const { rewriteImportMetaPaths } = await import(loaderUrl);',
        'const sample = [',
        '  \'const loader = resolve(import.meta.dirname, "x");\',',
        '  "const hint = \\"Use import.meta.dirname instead\\";",',
        '  "const key = { \\"import.meta.filename\\": true };",',
        '].join("\\n");',
        'const rewritten = rewriteImportMetaPaths(sample);',
        'if (!rewritten || !rewritten.includes("__mcpDirname(import.meta.url)")) process.exit(2);',
        'if (!rewritten.includes(\'"Use import.meta.dirname instead"\')) process.exit(3);',
        'if (!rewritten.includes(\'"import.meta.filename"\')) process.exit(4);',
        'if (rewriteImportMetaPaths(\'export const msg = "import.meta.dirname";\') !== null) process.exit(5);',
        'const { rewriteNode18Module } = await import(loaderUrl);',
        'const shimmed = rewriteNode18Module(\'import { styleText, stripVTControlCharacters } from "node:util";\\nstyleText("x", "y");\');',
        'if (!shimmed || !shimmed.includes("import * as __mcpNodeUtil") || !shimmed.includes("stripVTControlCharacters")) process.exit(9);',
        'await register(loaderUrl, { parentURL: import.meta.url });',
        'const mod = await import(pathToFileURL(probe).href);',
        'if (!same(mod.resolved, probe)) { console.error("resolved", mod.resolved, "probe", probe); process.exit(6); }',
        'if (!same(mod.named, probe)) process.exit(7);',
        'if (mod.hint !== "import.meta.dirname") process.exit(8);',
        'console.log("ok");',
      ].join('\n'),
      'utf8',
    );

    const child = spawnSync(process.execPath, [runnerFile, loaderFile, probeFile], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(child.status, `${child.stderr}\n${child.stdout}`).toBe(0);
    expect(child.stdout).toContain('ok');
  });
});
