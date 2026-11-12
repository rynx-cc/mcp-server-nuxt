#!/usr/bin/env tsx
/**
 * Readonly smoke against an installed mcp-server-nuxt binary (npm or local).
 *
 *   PACK_BIN=... REAL_PROJECT=... npx tsx scripts/npm-smoke-readonly.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function main(): Promise<void> {
  const bin = process.env.PACK_BIN;
  const project = process.env.REAL_PROJECT;
  if (!bin || !project) throw new Error('PACK_BIN and REAL_PROJECT are required');

  const tools: Array<[string, Record<string, unknown>]> = [
    ['get_project_overview', {}],
    ['list_routes', {}],
    ['list_components', { limit: 20 }],
    ['list_composables', {}],
    ['list_server_routes', {}],
    ['analyze_project', { limit: 10 }],
    ['get_auto_imports', {}],
  ];

  const transport = new StdioClientTransport({
    command: bin,
    args: ['--project', project],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'npm-smoke', version: '0.3.0' });
  await client.connect(transport);

  const listed = await client.listTools();
  const resources = await client.listResources();
  console.log(`tools: ${listed.tools.length}`);
  console.log(`resources: ${resources.resources.length}`);

  let failed = 0;
  for (const [name, args] of tools) {
    const t0 = Date.now();
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!)
      .join('\n');
    const ms = Date.now() - t0;
    const ok = text.trim().length > 0 && !/at Object\.|at async /.test(text) && ms < 5000;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${ms}ms ${text.slice(0, 120).replace(/\n/g, ' ')}`);
    if (!ok) failed += 1;
  }

  const routes = await client.callTool({ name: 'list_routes', arguments: {} });
  const routesText =
    (routes.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? '';
  console.log('list_routes sample:\n' + routesText.slice(0, 400));

  await client.close();
  if (failed) {
    console.error(`SMOKE_FAILED: ${failed}`);
    process.exit(1);
  }
  console.log('SMOKE_DONE');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
