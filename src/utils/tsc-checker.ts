/**
 * Run a programmatic TypeScript check against a Nuxt project and parse the
 * results into structured diagnostics.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { TscDiagnostic } from '../types.js';

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

function findTsc(root: string): { cmd: string; args: string[] } | null {
  const tsBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  if (existsSync(tsBin)) return { cmd: process.execPath, args: [tsBin] };
  const bin = path.join(root, 'node_modules', '.bin', 'tsc');
  if (existsSync(bin)) return { cmd: bin, args: [] };
  return null;
}

export async function runTscCheck(root: string): Promise<{
  ran: boolean;
  diagnostics: TscDiagnostic[];
  command?: string;
}> {
  const tsconfigs = [path.join(root, '.nuxt', 'tsconfig.json'), path.join(root, 'tsconfig.json')];
  const tsconfig = tsconfigs.find((f) => existsSync(f));
  if (!tsconfig) return { ran: false, diagnostics: [] };

  const tsc = findTsc(root);
  if (!tsc) return { ran: false, diagnostics: [] };

  const args = [...tsc.args, '--noEmit', '-p', tsconfig];
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(tsc.cmd, args, { cwd: root });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('close', () => resolve(`${stdout}\n${stderr}`));
    child.on('error', reject);
  });

  return {
    ran: true,
    diagnostics: parseTscOutput(output),
    command: [tsc.cmd, ...args].join(' '),
  };
}
