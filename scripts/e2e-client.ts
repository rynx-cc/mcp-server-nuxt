#!/usr/bin/env tsx
/**
 * Release-product e2e: drive the *packed* mcp-server-nuxt binary via the
 * official MCP Client + StdioClientTransport against a real Nuxt project.
 *
 * Usage:
 *   REAL_PROJECT=/tmp/... BARE_PROJECT=/tmp/... PACK_BIN=/tmp/.../node_modules/.bin/mcp-server-nuxt \
 *     npx tsx scripts/e2e-client.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

interface Row {
  name: string;
  kind: 'tool' | 'resource' | 'meta' | 'write';
  status: 'PASS' | 'FAIL';
  ms: number;
  summary: string;
}

const rows: Row[] = [];
const failures: string[] = [];

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function assertNoStack(text: string, label: string): void {
  if (/at Object\.|at async |at Module\.|Error: .*?\n\s+at /.test(text)) {
    throw new Error(`${label}: leaked stack trace`);
  }
}

function summarize(value: unknown, max = 120): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= max ? text : text.slice(0, max) + '…';
}

async function withClient(
  bin: string,
  project: string,
  allowWrites: boolean,
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const args = ['--project', project];
  if (allowWrites) args.push('--allow-writes');

  const transport = new StdioClientTransport({
    command: bin,
    args,
    stderr: 'pipe',
  });

  const client = new Client({ name: 'e2e-client', version: '0.3.0' });
  const started = performance.now();
  await client.connect(transport);
  try {
    await fn(client);
  } finally {
    await client.close();
    const ms = Math.round(performance.now() - started);
    // Process must exit; close() should tear down stdio child.
    rows.push({
      name: `session close (${allowWrites ? 'writes' : 'readonly'})`,
      kind: 'meta',
      status: 'PASS',
      ms,
      summary: `project=${path.basename(project)}`,
    });
  }
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
  opts: { expectNonEmpty?: boolean; maxMs?: number; kind?: Row['kind'] } = {},
): Promise<unknown> {
  const maxMs = opts.maxMs ?? 5000;
  const t0 = performance.now();
  try {
    const result = await client.callTool({ name, arguments: args });
    const ms = Math.round(performance.now() - t0);
    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!)
      .join('\n');
    assertNoStack(text, name);
    if (!text.trim() && opts.expectNonEmpty !== false) {
      throw new Error('empty tool result');
    }
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep text */
    }
    if (parsed && typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const err = (parsed as { error: unknown }).error;
      // Structured tool-level errors are allowed for not-found style probes,
      // but they must still be objects with code/message (no stacks).
      if (typeof err === 'string' && /at /.test(err)) {
        throw new Error(`unstructured error string: ${err}`);
      }
    }
    if (ms > maxMs) throw new Error(`took ${ms}ms (>${maxMs}ms)`);
    rows.push({
      name,
      kind: opts.kind ?? 'tool',
      status: 'PASS',
      ms,
      summary: summarize(parsed),
    });
    return parsed;
  } catch (error) {
    const ms = Math.round(performance.now() - t0);
    const message = error instanceof Error ? error.message : String(error);
    rows.push({ name, kind: opts.kind ?? 'tool', status: 'FAIL', ms, summary: message });
    failures.push(`${name}: ${message}`);
    throw error;
  }
}

async function readResource(client: Client, uri: string): Promise<void> {
  const t0 = performance.now();
  try {
    const result = await client.readResource({ uri });
    const ms = Math.round(performance.now() - t0);
    const text = result.contents.map((c) => ('text' in c ? String(c.text ?? '') : '')).join('\n');
    assertNoStack(text, uri);
    if (!text.trim()) throw new Error('empty resource');
    if (ms > 5000) throw new Error(`took ${ms}ms`);
    rows.push({ name: uri, kind: 'resource', status: 'PASS', ms, summary: summarize(text) });
  } catch (error) {
    const ms = Math.round(performance.now() - t0);
    const message = error instanceof Error ? error.message : String(error);
    rows.push({ name: uri, kind: 'resource', status: 'FAIL', ms, summary: message });
    failures.push(`${uri}: ${message}`);
    throw error;
  }
}

const READONLY_TOOLS: Array<{ name: string; args?: Record<string, unknown> }> = [
  { name: 'get_project_overview' },
  { name: 'list_routes' },
  { name: 'get_route', args: { path: '/' } },
  { name: 'list_components', args: { limit: 50 } },
  { name: 'inspect_component', args: { name: 'BaseBadge' } },
  { name: 'list_composables' },
  { name: 'list_server_routes' },
  { name: 'list_modules' },
  { name: 'read_config' },
  { name: 'analyze_project', args: { limit: 20 } },
  { name: 'get_auto_imports' },
  { name: 'get_type_info' },
  { name: 'inspect_layers' },
  { name: 'search_code', args: { query: 'BaseBadge', limit: 10 } },
  { name: 'analyze_bundle_deps' },
  { name: 'inspect_route_meta', args: { path: '/' } },
  { name: 'check_type_errors' },
  { name: 'get_nuxt_docs', args: { topic: 'routing' } },
];

const RESOURCES = [
  'nuxt://project/overview',
  'nuxt://project/routes',
  'nuxt://project/config',
  'nuxt://project/modules',
  'nuxt://project/layers',
  'nuxt://project/auto-imports',
  'nuxt://project/types',
];

async function runReadonlySuite(client: Client, label: string): Promise<void> {
  const listed = await client.listTools();
  rows.push({
    name: `listTools (${label})`,
    kind: 'meta',
    status: listed.tools.length >= 15 ? 'PASS' : 'FAIL',
    ms: 0,
    summary: `${listed.tools.length} tools`,
  });
  if (listed.tools.length < 15) failures.push(`listTools too few: ${listed.tools.length}`);

  const resources = await client.listResources();
  rows.push({
    name: `listResources (${label})`,
    kind: 'meta',
    status: resources.resources.length >= 5 ? 'PASS' : 'FAIL',
    ms: 0,
    summary: `${resources.resources.length} resources`,
  });
  if (resources.resources.length < 5) failures.push(`listResources too few: ${resources.resources.length}`);

  for (const tool of READONLY_TOOLS) {
    await callTool(client, tool.name, tool.args ?? {});
  }
  for (const uri of RESOURCES) {
    await readResource(client, uri);
  }
}

async function runDryWrites(client: Client): Promise<void> {
  const checks: Array<{ name: string; args: Record<string, unknown>; pathKey?: string }> = [
    { name: 'add_route', args: { path: '/e2e-dry', dryRun: true } },
    { name: 'generate_component', args: { name: 'E2eDryCard', dryRun: true, props: { title: 'string' } } },
    { name: 'generate_composable', args: { name: 'e2eDry', dryRun: true } },
    { name: 'scaffold_nitro_api', args: { path: '/api/e2e-dry', method: 'get', dryRun: true } },
    { name: 'update_config', args: { key: 'ssr', value: 'true', dryRun: true } },
  ];
  for (const check of checks) {
    const result = (await callTool(client, check.name, check.args, { kind: 'write' })) as Record<string, unknown>;
    if (result.written === true) throw new Error(`${check.name} wrote during dryRun`);
  }
}

async function runRealWrites(client: Client, project: string): Promise<void> {
  const page = (await callTool(
    client,
    'add_route',
    { path: '/e2e-live', dryRun: false },
    { kind: 'write' },
  )) as Record<string, unknown>;
  if (page.written !== true || !(await exists(String(page.path)))) {
    throw new Error(`missing page: ${JSON.stringify(page)}`);
  }

  const genComp = (await callTool(
    client,
    'generate_component',
    { name: 'E2eLiveCard', dryRun: false, props: { title: 'string' } },
    { kind: 'write' },
  )) as Record<string, unknown>;
  const genCompPath = String(genComp.path);
  if (genComp.written !== true || !(await exists(genCompPath))) {
    throw new Error(`missing component ${genCompPath}`);
  }

  const genComp2 = (await callTool(
    client,
    'generate_composable',
    { name: 'e2eLive', dryRun: false },
    { kind: 'write' },
  )) as Record<string, unknown>;
  if (genComp2.written !== true || !(await exists(String(genComp2.path)))) {
    throw new Error('missing composable');
  }

  const api = (await callTool(
    client,
    'scaffold_nitro_api',
    { path: '/api/e2e-live', method: 'get', dryRun: false },
    { kind: 'write' },
  )) as Record<string, unknown>;
  if (api.written !== true || !(await exists(String(api.path)))) {
    throw new Error('missing api');
  }

  const cfg = (await callTool(
    client,
    'update_config',
    { key: 'ssr', value: 'true', dryRun: false },
    { kind: 'write' },
  )) as Record<string, unknown>;
  if (cfg.written !== true && cfg.ok !== true) {
    throw new Error(`update_config failed: ${JSON.stringify(cfg)}`);
  }

  for (const p of [genCompPath, String(genComp2.path), String(api.path), String(page.path)]) {
    if (!path.resolve(p).startsWith(path.resolve(project) + path.sep) && path.resolve(p) !== path.resolve(project)) {
      throw new Error(`wrote outside project: ${p}`);
    }
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function printTable(): string {
  const header = '| Name | Kind | Status | ms | Summary |\n| --- | --- | --- | ---: | --- |';
  const body = rows
    .map((r) => `| \`${r.name}\` | ${r.kind} | **${r.status}** | ${r.ms} | ${r.summary.replace(/\|/g, '\\|')} |`)
    .join('\n');
  return `${header}\n${body}\n`;
}

async function main(): Promise<void> {
  const bin = env('PACK_BIN');
  const realProject = env('REAL_PROJECT');
  const bareProject = env('BARE_PROJECT');
  const reportPath = env('REPORT_PATH', path.resolve('docs/e2e-report.md'));

  console.error('E2E against packed binary:', bin);
  console.error('Real project:', realProject);
  console.error('Bare project:', bareProject);

  // 1) Prepared real project — readonly + dry writes
  await withClient(bin, realProject, false, async (client) => {
    await runReadonlySuite(client, 'real');
    await runDryWrites(client);
  });

  // 2) Bare project (no node_modules / .nuxt) — degradation path
  await withClient(bin, bareProject, false, async (client) => {
    const overview = (await callTool(client, 'get_project_overview')) as Record<string, unknown>;
    if (overview.built !== false) throw new Error('bare project should report built:false');
    const auto = (await callTool(client, 'get_auto_imports')) as Record<string, unknown>;
    if (auto.built !== false) throw new Error('bare get_auto_imports should be built:false');
    const analysis = (await callTool(client, 'analyze_project')) as Record<string, unknown>;
    const hints = (analysis.hints as string[]) ?? [];
    if (!hints.some((h) => /nuxi prepare/i.test(h))) {
      throw new Error('bare analyze_project missing prepare hint');
    }
    await callTool(client, 'list_routes');
    await callTool(client, 'list_components', { limit: 20 });
  });

  // 3) Real writes
  await withClient(bin, realProject, true, async (client) => {
    await runRealWrites(client, realProject);
  });

  // 4) Project still prepares / typechecks
  const t0 = performance.now();
  const { spawnSync } = await import('node:child_process');
  const prepare = spawnSync('npx', ['nuxi', 'prepare'], { cwd: realProject, encoding: 'utf8', timeout: 120_000 });
  const ms = Math.round(performance.now() - t0);
  if (prepare.status !== 0) {
    rows.push({
      name: 'nuxi prepare after writes',
      kind: 'meta',
      status: 'FAIL',
      ms,
      summary: summarize(prepare.stderr || prepare.stdout),
    });
    failures.push('nuxi prepare failed after writes');
  } else {
    rows.push({
      name: 'nuxi prepare after writes',
      kind: 'meta',
      status: 'PASS',
      ms,
      summary: 'types regenerated',
    });
  }

  const table = printTable();
  const passed = rows.filter((r) => r.status === 'PASS').length;
  const failed = rows.filter((r) => r.status === 'FAIL').length;
  const md = `# mcp-server-nuxt 0.3.0 e2e report

Generated: ${new Date().toISOString()}

- Packed binary: \`${bin}\`
- Real project: \`${realProject}\`
- Bare project: \`${bareProject}\`
- Rows: ${rows.length} — **${passed} PASS** / **${failed} FAIL**

## Results

${table}

## Failures

${failures.length ? failures.map((f) => `- ${f}`).join('\n') : '_None_'}
`;
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, md, 'utf8');
  console.log(table);
  console.error(`Wrote ${reportPath}`);
  if (failures.length) {
    console.error('FAILURES:\n' + failures.join('\n'));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
