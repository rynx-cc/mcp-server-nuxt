import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTscOutput, runTscCheck } from '../src/utils/tsc-checker.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('parseTscOutput', () => {
  it('parses error and warning lines', () => {
    const output = [
      "src/foo.ts(3,5): error TS2304: Cannot find name 'x'.",
      "src/bar.ts(10,2): warning TS6133: 'y' is declared but its value is never read.",
      'Found 1 error in src/foo.ts:3',
    ].join('\n');

    const diagnostics = parseTscOutput(output);
    expect(diagnostics).toEqual([
      { file: 'src/foo.ts', line: 3, column: 5, severity: 'error', code: 2304, message: "Cannot find name 'x'." },
      { file: 'src/bar.ts', line: 10, column: 2, severity: 'warning', code: 6133, message: "'y' is declared but its value is never read." },
    ]);
  });

  it('returns an empty array for non-diagnostic output', () => {
    expect(parseTscOutput('')).toEqual([]);
    expect(parseTscOutput('no diagnostics here')).toEqual([]);
  });
});

describe('runTscCheck', () => {
  it(
    'typechecks referenced projects instead of an empty solution tsconfig',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-tsc-'));
      tempDirs.push(root);
      await fs.writeFile(
        path.join(root, 'tsconfig.json'),
        JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }] }),
      );
      await fs.writeFile(
        path.join(root, 'tsconfig.app.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            noEmit: true,
          },
          include: ['src'],
        }),
      );
      await fs.mkdir(path.join(root, 'src'));
      await fs.writeFile(path.join(root, 'src/bad.ts'), 'export const n: number = "nope";\n');
      await fs.symlink(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'));

      const result = await runTscCheck(root);
      expect(result.ran).toBe(true);
      expect(result.projects).toEqual([path.join(root, 'tsconfig.app.json')]);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === 2322)).toBe(true);
    },
    20_000,
  );

  it('explains when no tsconfig exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-tsc-empty-'));
    tempDirs.push(root);
    const result = await runTscCheck(root);
    expect(result).toMatchObject({ ran: false, diagnostics: [] });
    expect(result.reason).toMatch(/tsconfig/);
  });
});
