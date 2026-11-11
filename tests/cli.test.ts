import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'dist', 'index.js');
const hasDist = existsSync(entry);

describe.skipIf(!hasDist)('CLI flags', () => {
  it('--version prints version on stderr', () => {
    const result = spawnSync(process.execPath, [entry, '--version'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('--help prints usage', () => {
    const result = spawnSync(process.execPath, [entry, '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Usage:');
    expect(result.stderr).toContain('--project');
  });

  it('--project selects the fixture root', () => {
    const fixture = path.join(root, 'tests/fixtures/nuxt3-minimal');
    const result = spawnSync(process.execPath, [entry, '--project', fixture, '--help'], { encoding: 'utf8' });
    // --help exits before bind; just ensure arg parsing does not throw
    expect(result.status).toBe(0);
  });
});
