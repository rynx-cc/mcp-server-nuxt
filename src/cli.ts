/**
 * Parse the stdio CLI.
 *
 * The project path is optional and may appear before or after flags.
 * `--allow-writes` is never treated as a directory name.
 */
import path from 'node:path';

export interface CliOptions {
  projectPath: string;
  allowWrites: boolean;
}

export function parseCliArgs(
  argv: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): CliOptions {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  let allowWrites = env.MCP_NUXT_ALLOW_WRITES === '1';
  const positional: string[] = [];
  const args = argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg === '--allow-writes') {
      allowWrites = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option "${arg}". Usage: mcp-server-nuxt [project-path] [--allow-writes]`);
    }
    positional.push(arg);
  }

  if (positional.length > 1) {
    throw new Error(`Expected a single project path, received: ${positional.join(' ')}`);
  }

  return {
    projectPath: path.resolve(cwd, positional[0] ?? '.'),
    allowWrites,
  };
}
