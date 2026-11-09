/**
 * Write authorization guard shared by every mutating tool.
 *
 * All write tools accept a `dryRun` flag (default true) and always return a
 * plan. Real disk writes only happen when `dryRun` is false AND the server
 * was started with writes enabled (`MCP_NUXT_ALLOW_WRITES=1` or `--allow-writes`).
 */
export class WriteGuard {
  constructor(readonly allowWrites: boolean) {}

  /**
   * Decide whether a write operation may proceed.
   *
   * @param dryRun when true, no disk write is attempted — always allowed.
   */
  authorize(dryRun: boolean): { ok: true } | { ok: false; error: string } {
    if (dryRun) return { ok: true };
    if (this.allowWrites) return { ok: true };
    return {
      ok: false,
      error:
        'Write operations are disabled. Set MCP_NUXT_ALLOW_WRITES=1 or pass --allow-writes to enable real writes. Dry-run plans are always available.',
    };
  }
}
