import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NuxtProjectContext } from '../src/context.js';
import { registerConfigTools } from '../src/tools/config.js';

let base: string;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'nuxt-config-tool-'));
  await fs.writeFile(
    path.join(base, 'nuxt.config.ts'),
    "export default defineNuxtConfig({\n  ssr: true,\n  runtimeConfig: { public: { apiBase: 'https://api.example.com' } },\n})",
    'utf8',
  );
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

type Tool = { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: Array<{ text: string }> }> };

async function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
  const tool = (server as unknown as { _registeredTools: Record<string, Tool> })._registeredTools[name]!;
  const result = await tool.handler(args, {});
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

async function readConfig() {
  return fs.readFile(path.join(base, 'nuxt.config.ts'), 'utf8');
}

describe('update_config dry-run and guard', () => {
  it('dry-run does not write the file and returns a diff', async () => {
    const ctx = new NuxtProjectContext(base);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerConfigTools(server, ctx);

    const before = await readConfig();
    const result = await callTool(server, 'update_config', { key: 'ssr', value: 'false' });
    expect(result.written).toBe(false);
    expect(result.ok).toBe(true);
    expect(typeof result.diff).toBe('string');
    expect(await readConfig()).toBe(before);
  });

  it('refuses real writes when the guard disallows them', async () => {
    const ctx = new NuxtProjectContext(base); // allowWrites defaults to false
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerConfigTools(server, ctx);

    const before = await readConfig();
    const result = await callTool(server, 'update_config', { key: 'ssr', value: 'false', dryRun: false });
    expect(result.ok).toBe(false);
    expect(await readConfig()).toBe(before);
  });

  it('writes when writes are enabled', async () => {
    const ctx = new NuxtProjectContext(base, { allowWrites: true });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerConfigTools(server, ctx);

    const result = await callTool(server, 'update_config', { key: 'ssr', value: 'false', dryRun: false });
    expect(result.written).toBe(true);
    expect(await readConfig()).toContain('ssr: false');
  });

  it('appends a new top-level key with a comma after the previous property', async () => {
    await fs.writeFile(
      path.join(base, 'nuxt.config.ts'),
      "export default defineNuxtConfig({\n  compatibilityDate: '2025-07-15',\n  devtools: { enabled: true }\n})\n",
      'utf8',
    );
    const ctx = new NuxtProjectContext(base, { allowWrites: true });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerConfigTools(server, ctx);

    const result = await callTool(server, 'update_config', { key: 'ssr', value: 'true', dryRun: false });
    expect(result.written).toBe(true);
    const source = await readConfig();
    expect(source).toContain('devtools: { enabled: true },');
    expect(source).toContain('ssr: true');
    // Must remain parseable — no adjacent properties without a comma.
    expect(source).not.toMatch(/\}\s*\nssr:/);
  });
});
