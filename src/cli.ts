/**
 * Parse the stdio CLI.
 *
 * The project path is optional and may appear before or after flags.
 * `--allow-writes` is never treated as a directory name.
 */
import path from 'node:path';

export const CLI_VERSION = '0.4.0';

export interface CliOptions {
  projectPath: string;
  allowWrites: boolean;
  help: boolean;
  version: boolean;
}

export function printHelp(): void {
  const text = `mcp-server-nuxt v${CLI_VERSION}

Usage:
  mcp-server-nuxt [options] [project-path]
  mcp-server-nuxt --project <path> [options]

A Model Context Protocol server that exposes Nuxt's resolved project state
to AI agents over stdio.

Options:
  -p, --project <path>   Nuxt project root (default: cwd)
      --allow-writes     Enable mutating tools to write to disk
  -h, --help             Show this help
  -V, --version          Show version

Environment:
  MCP_NUXT_ALLOW_WRITES=1   Same as --allow-writes

Examples:
  npx mcp-server-nuxt /absolute/path/to/nuxt/app
  mcp-server-nuxt --project ./apps/web --allow-writes
`;
  console.error(text);
}

export function parseCliArgs(
  argv: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): CliOptions {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  let allowWrites = env.MCP_NUXT_ALLOW_WRITES === '1';
  let help = false;
  let version = false;
  let projectPath: string | undefined;
  const positional: string[] = [];
  const args = argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--version' || arg === '-V') {
      version = true;
      continue;
    }
    if (arg === '--allow-writes') {
      allowWrites = true;
      continue;
    }
    if (arg === '--project' || arg === '-p') {
      const next = args[++i];
      if (!next) throw new Error('--project requires a path argument');
      projectPath = next;
      continue;
    }
    if (arg.startsWith('--project=')) {
      projectPath = arg.slice('--project='.length);
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(
        `Unknown option "${arg}". Usage: mcp-server-nuxt [project-path] [--project <path>] [--allow-writes] [--help] [--version]`,
      );
    }
    positional.push(arg);
  }

  if (projectPath !== undefined && positional.length > 0) {
    throw new Error('Pass the project path either positionally or via --project, not both');
  }
  if (positional.length > 1) {
    throw new Error(`Expected a single project path, received: ${positional.join(' ')}`);
  }

  return {
    projectPath: path.resolve(cwd, projectPath ?? positional[0] ?? '.'),
    allowWrites,
    help,
    version,
  };
}
