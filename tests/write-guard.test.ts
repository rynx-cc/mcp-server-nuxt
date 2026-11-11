import { describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { WriteGuard } from '../src/utils/write-guard.js';

describe('WriteGuard', () => {
  it('allows dry-run even when writes are disabled', () => {
    expect(new WriteGuard(false).authorize(true)).toEqual({ ok: true });
  });

  it('refuses real writes when disabled with structured error', () => {
    const result = new WriteGuard(false).authorize(false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNAUTHORIZED');
      expect(result.error.hint).toContain('MCP_NUXT_ALLOW_WRITES');
    }
  });

  it('allows real writes when enabled', () => {
    expect(new WriteGuard(true).authorize(false)).toEqual({ ok: true });
  });

  it('rejects paths that escape the project root', () => {
    const root = path.join(os.tmpdir(), 'nuxt-wg-root');
    const guard = new WriteGuard(true, root);
    const bad = guard.assertInsideProject('../outside.ts');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('INVALID_PATH');

    const good = guard.assertInsideProject('composables/useFoo.ts');
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.path).toBe(path.join(root, 'composables/useFoo.ts'));
  });
});
