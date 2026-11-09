import { describe, expect, it } from 'vitest';
import { WriteGuard } from '../src/utils/write-guard.js';

describe('WriteGuard', () => {
  it('allows dry-run even when writes are disabled', () => {
    expect(new WriteGuard(false).authorize(true)).toEqual({ ok: true });
  });

  it('refuses real writes when disabled', () => {
    const result = new WriteGuard(false).authorize(false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('MCP_NUXT_ALLOW_WRITES');
    }
  });

  it('allows real writes when enabled', () => {
    expect(new WriteGuard(true).authorize(false)).toEqual({ ok: true });
  });
});
