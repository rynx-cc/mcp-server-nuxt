/**
 * Write authorization guard shared by every mutating tool.
 *
 * All write tools accept a `dryRun` flag (default true) and always return a
 * plan. Real disk writes only happen when `dryRun` is false AND the server
 * was started with writes enabled (`MCP_NUXT_ALLOW_WRITES=1` or `--allow-writes`).
 */
import path from 'node:path';

export class WriteGuard {
  constructor(
    readonly allowWrites: boolean,
    readonly projectRoot?: string,
  ) {}

  /**
   * Decide whether a write operation may proceed.
   *
   * @param dryRun when true, no disk write is attempted — always allowed.
   */
  authorize(dryRun: boolean): { ok: true } | { ok: false; error: { code: 'UNAUTHORIZED'; message: string; hint: string } } {
    if (dryRun) return { ok: true };
    if (this.allowWrites) return { ok: true };
    return {
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Write operations are disabled.',
        hint: 'Set MCP_NUXT_ALLOW_WRITES=1 or pass --allow-writes to enable real writes. Dry-run plans are always available.',
      },
    };
  }

  /**
   * Ensure a target path stays inside the project root (blocks `../` traversal).
   */
  assertInsideProject(targetPath: string): { ok: true; path: string } | { ok: false; error: { code: 'INVALID_PATH'; message: string; hint: string } } {
    const root = path.resolve(this.projectRoot ?? process.cwd());
    const resolved = path.resolve(root, targetPath);
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_PATH',
          message: `Refusing to write outside the project root: ${resolved}`,
          hint: 'Pass a path under the Nuxt project directory. Relative paths like ../ are rejected.',
        },
      };
    }
    return { ok: true, path: resolved };
  }
}
