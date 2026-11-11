/**
 * Run a programmatic TypeScript check against a Nuxt project and parse the
 * results into structured diagnostics.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { TscDiagnostic } from '../types.js';

const CHECK_TIMEOUT_MS = 120_000;

/**
 * Parse `tsc` stdout/stderr into structured diagnostics.
 * Handles lines like `src/foo.ts(3,5): error TS2304: Cannot find name 'x'.`
 */
export function parseTscOutput(output: string): TscDiagnostic[] {
  const diagnostics: TscDiagnostic[] = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^([^(]+)\((\d+),(\d+)\):\s*(error|warning)\s+TS(\d+):\s+(.+)$/);
    if (!m) continue;
    diagnostics.push({
      file: m[1]!.trim() || undefined,
      line: Number(m[2]),
      column: Number(m[3]),
      severity: m[4] === 'error' ? 'error' : 'warning',
      code: Number(m[5]),
      message: m[6]!.trim(),
    });
  }
  return diagnostics;
}

interface TsConfigShape {
  files?: unknown[];
  include?: unknown[];
  references?: Array<{ path?: string }>;
}

function parseJsonc(text: string): TsConfigShape | null {
  try {
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(stripped) as TsConfigShape;
  } catch {
    return null;
  }
}

function isSolution(config: TsConfigShape): boolean {
  const hasRefs = Array.isArray(config.references) && config.references.some((ref) => typeof ref?.path === 'string');
  const filesEmpty = !Array.isArray(config.files) || config.files.length === 0;
  const includeEmpty = !Array.isArray(config.include) || config.include.length === 0;
  return hasRefs && filesEmpty && includeEmpty;
}

function referencedConfigPath(fromFile: string, ref: string): string | null {
  const abs = path.resolve(path.dirname(fromFile), ref);
  if (!existsSync(abs)) return null;
  if (statSync(abs).isDirectory()) {
    const nested = path.join(abs, 'tsconfig.json');
    return existsSync(nested) ? nested : null;
  }
  return abs;
}

/** Expand a solution-style tsconfig into the projects `tsc -p` will actually check. */
export function collectTsProjects(entry: string, seen = new Set<string>()): string[] {
  const abs = path.resolve(entry);
  if (seen.has(abs) || !existsSync(abs)) return [];
  seen.add(abs);
  let text = '';
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    return [abs];
  }
  const config = parseJsonc(text);
  if (!config || !isSolution(config)) return [abs];
  const projects: string[] = [];
  for (const ref of config.references ?? []) {
    if (!ref?.path) continue;
    const next = referencedConfigPath(abs, ref.path);
    if (!next) continue;
    projects.push(...collectTsProjects(next, seen));
  }
  return projects;
}

function resolveBin(root: string, name: string, jsRel: string): { cmd: string; args: string[] } | null {
  const js = path.join(root, 'node_modules', jsRel);
  if (existsSync(js)) return { cmd: process.execPath, args: [js] };
  const shim = path.join(root, 'node_modules', '.bin', name);
  if (existsSync(shim)) return { cmd: shim, args: [] };
  return null;
}

function findChecker(root: string): { cmd: string; args: string[] } | null {
  return resolveBin(root, 'vue-tsc', 'vue-tsc/bin/vue-tsc.js') ?? resolveBin(root, 'tsc', 'typescript/bin/tsc');
}

function runChecker(cmd: string, args: string[], cwd: string): Promise<{ output: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), CHECK_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (_code, signal) => {
      clearTimeout(timer);
      resolve({ output: `${stdout}\n${stderr}`, timedOut: signal === 'SIGKILL' });
    });
  });
}

export async function runTscCheck(root: string): Promise<{
  ran: boolean;
  diagnostics: TscDiagnostic[];
  command?: string;
  reason?: string;
  projects?: string[];
}> {
  const tsconfigs = [path.join(root, '.nuxt', 'tsconfig.json'), path.join(root, 'tsconfig.json')];
  const tsconfig = tsconfigs.find((file) => existsSync(file));
  if (!tsconfig) {
    return { ran: false, diagnostics: [], reason: 'No tsconfig.json or .nuxt/tsconfig.json found.' };
  }

  const checker = findChecker(root);
  if (!checker) {
    return { ran: false, diagnostics: [], reason: 'Neither vue-tsc nor tsc is installed in the project.' };
  }

  const projects = collectTsProjects(tsconfig);
  if (projects.length === 0) {
    return { ran: false, diagnostics: [], reason: `No TypeScript projects could be resolved from ${tsconfig}.` };
  }

  const diagnostics: TscDiagnostic[] = [];
  const commands: string[] = [];
  let timedOut = false;
  for (const project of projects) {
    const args = [...checker.args, '--noEmit', '--pretty', 'false', '--incremental', 'false', '-p', project];
    commands.push([checker.cmd, ...args].join(' '));
    const result = await runChecker(checker.cmd, args, root);
    diagnostics.push(...parseTscOutput(result.output));
    if (result.timedOut) {
      timedOut = true;
      break;
    }
  }

  return {
    ran: true,
    diagnostics,
    command: commands.join(' && '),
    projects,
    reason: timedOut ? `Type check timed out after ${CHECK_TIMEOUT_MS}ms.` : undefined,
  };
}
