import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../src/cli.js';

describe('parseCliArgs', () => {
  const cwd = '/workspace/app';

  it('uses the current directory when no path is given', () => {
    expect(parseCliArgs(['node', 'mcp-server-nuxt'], { cwd, env: {} })).toEqual({
      projectPath: path.resolve(cwd),
      allowWrites: false,
    });
  });

  it('does not treat --allow-writes as the project path', () => {
    expect(parseCliArgs(['node', 'mcp-server-nuxt', '--allow-writes'], { cwd, env: {} })).toEqual({
      projectPath: path.resolve(cwd),
      allowWrites: true,
    });
    expect(parseCliArgs(['node', 'mcp-server-nuxt', '--allow-writes', 'packages/web'], { cwd, env: {} })).toEqual({
      projectPath: path.resolve(cwd, 'packages/web'),
      allowWrites: true,
    });
    expect(parseCliArgs(['node', 'mcp-server-nuxt', 'packages/web', '--allow-writes'], { cwd, env: {} })).toEqual({
      projectPath: path.resolve(cwd, 'packages/web'),
      allowWrites: true,
    });
  });

  it('honors MCP_NUXT_ALLOW_WRITES=1 without a flag', () => {
    expect(parseCliArgs(['node', 'mcp-server-nuxt', '.'], { cwd, env: { MCP_NUXT_ALLOW_WRITES: '1' } }).allowWrites).toBe(
      true,
    );
  });

  it('rejects unknown options instead of using them as a directory', () => {
    expect(() => parseCliArgs(['node', 'mcp-server-nuxt', '--help'], { cwd, env: {} })).toThrow(/Unknown option/);
  });
});
