/**
 * Auto type generation: when `.nuxt` is missing, get_type_info / check_type_errors
 * still work via loadNuxt → buildNuxt → writeTypes into an external cache.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setupServer } from '../src/server.js';
import { resolveTypesCacheDir } from '../src/utils/types-generator.js';

const fixtureSrc = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'nuxt3-minimal',
);

type Tool = {
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: Array<{ text: string }> }>;
};

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = (server as unknown as { _registeredTools: Record<string, Tool> })._registeredTools[name]!;
  const result = await tool.handler(args, {});
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyFixture(dest: string): Promise<void> {
  await fs.cp(fixtureSrc, dest, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}node_modules`) && !src.includes(`${path.sep}.nuxt`),
  });
}

describe('auto type generation (nuxt3-minimal)', () => {
  let workRoot: string;
  let firstGenMs = 0;

  beforeAll(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-nuxt-auto-types-'));
    await copyFixture(workRoot);
    const install = spawnSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['install', '--no-fund', '--no-audit', '--no-progress'],
      {
        cwd: workRoot,
        encoding: 'utf8',
        timeout: 300_000,
        env: {
          ...process.env,
          CI: '1',
          npm_config_fund: 'false',
          npm_config_audit: 'false',
          npm_config_progress: 'false',
          npm_config_update_notifier: 'false',
        },
      },
    );
    if (install.error || install.status !== 0) {
      throw new Error(
        `npm install failed (status=${install.status}, signal=${install.signal}):\n${install.error?.message ?? ''}\n${install.stderr || install.stdout}`,
      );
    }
    // Ensure unprepared
    await fs.rm(path.join(workRoot, '.nuxt'), { recursive: true, force: true });
  }, 360_000);

  afterAll(async () => {
    if (workRoot) await fs.rm(workRoot, { recursive: true, force: true });
  });

  it('get_type_info and check_type_errors work without project .nuxt, and do not create one', async () => {
    expect(await pathExists(path.join(workRoot, '.nuxt'))).toBe(false);

    const server = new McpServer({ name: 'auto-types', version: '0.0.0' });
    const { watcher, ctx } = await setupServer(server, workRoot);
    try {
      const t0 = Date.now();
      const typeInfo = await callTool(server, 'get_type_info');
      firstGenMs = Date.now() - t0;

      expect(typeInfo.error).toBeUndefined();
      expect(typeof typeInfo.importsDts === 'string' && (typeInfo.importsDts as string).length > 0).toBe(true);
      expect(typeInfo.source === 'generated' || typeInfo.source === 'cache').toBe(true);
      expect(typeInfo.typesRoot).toBeTruthy();
      expect(String(typeInfo.typesRoot)).not.toContain(`${path.sep}.nuxt`);

      // Project must stay clean
      expect(await pathExists(path.join(workRoot, '.nuxt'))).toBe(false);

      // Cache should exist under node_modules/.cache or tmp
      const cacheDir = resolveTypesCacheDir(workRoot);
      expect(await pathExists(cacheDir)).toBe(true);
      expect(
        (await pathExists(path.join(cacheDir, 'tsconfig.json'))) ||
          (await pathExists(path.join(cacheDir, 'imports.d.ts'))),
      ).toBe(true);

      const check = await callTool(server, 'check_type_errors');
      // ran may be false if tsc/vue-tsc missing, but must not crash / require project .nuxt
      expect(check.error).toBeUndefined();
      expect(check.typesRoot).toBeTruthy();
      expect(await pathExists(path.join(workRoot, '.nuxt'))).toBe(false);

      // Second call hits cache (no re-generate flag)
      const again = await ctx.typeInfo();
      expect(again.source === 'cache' || again.source === 'generated').toBe(true);
      expect(again.importsDts).toBeTruthy();

      // Overview hint no longer demands manual prepare as the only path
      const analysis = await callTool(server, 'analyze_project');
      const hints = (analysis.hints as string[]) ?? [];
      expect(hints.some((h) => /auto-generate/i.test(h))).toBe(true);
    } finally {
      watcher.stop();
    }

    // Expose timing for the agent report (also assert it finished in a sane bound)
    expect(firstGenMs).toBeGreaterThan(0);
    expect(firstGenMs).toBeLessThan(120_000);
    // eslint-disable-next-line no-console
    console.log(`[auto-types] first get_type_info wall time: ${firstGenMs}ms`);
  }, 180_000);
});
