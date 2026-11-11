import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NuxtProjectContext } from '../src/context.js';
import { registerComponentTools } from '../src/tools/components.js';
import { registerDiagnosticTools } from '../src/tools/diagnostics.js';
import { registerSearchTools } from '../src/tools/search.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'large-components');

type Tool = {
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: Array<{ text: string }> }>;
};

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tool = (server as unknown as { _registeredTools: Record<string, Tool> })._registeredTools[name]!;
  const result = await tool.handler(args, {});
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

beforeAll(async () => {
  const dir = path.join(fixture, 'components');
  await fs.mkdir(dir, { recursive: true });
  // Ensure at least 520 components exist (idempotent).
  for (let i = 0; i < 520; i++) {
    const name = `Comp${String(i).padStart(4, '0')}`;
    const file = path.join(dir, `${name}.vue`);
    try {
      await fs.access(file);
    } catch {
      await fs.writeFile(file, `<template><div>${name}</div></template>\n`);
    }
  }
  await fs.mkdir(path.join(fixture, 'pages'), { recursive: true });
  await fs.writeFile(path.join(fixture, 'pages/index.vue'), '<template><div>large</div></template>\n').catch(() => undefined);
});

afterAll(async () => {
  // Keep generated fixtures for local inspection; CI workspace is ephemeral.
});

describe('pagination + large project performance', () => {
  it('list_components respects limit/offset under 2s for 500+ components', async () => {
    const ctx = new NuxtProjectContext(fixture);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerComponentTools(server, ctx);

    const started = Date.now();
    const page = await callTool(server, 'list_components', { limit: 25, offset: 100 });
    const elapsed = Date.now() - started;

    expect(page.total as number).toBeGreaterThanOrEqual(500);
    expect(page.count).toBe(25);
    expect(page.offset).toBe(100);
    expect(page.truncated).toBe(true);
    expect(elapsed).toBeLessThan(2000);
  });

  it('analyze_project paginates component samples', async () => {
    const ctx = new NuxtProjectContext(fixture);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerDiagnosticTools(server, ctx);

    const result = await callTool(server, 'analyze_project', { limit: 10, offset: 0 });
    expect((result.components as { total: number }).total).toBeGreaterThanOrEqual(500);
    expect(((result.components as { items: unknown[] }).items ?? []).length).toBe(10);
    expect((result.components as { truncated: boolean }).truncated).toBe(true);
  });

  it('search_code supports limit/offset', async () => {
    const ctx = new NuxtProjectContext(fixture);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerSearchTools(server, ctx);

    const result = await callTool(server, 'search_code', { query: 'Comp0', limit: 5, offset: 0 });
    expect((result.count as number) <= 5).toBe(true);
    expect(result.limit).toBe(5);
  });
});
