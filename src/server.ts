/**
 * Wire a McpServer instance to the Nuxt project context and register every
 * tool and resource. Shared by the stdio entrypoint and tests.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NuxtProjectContext } from './context.js';
import { registerAllTools } from './tools/index.js';
import { registerAllResources } from './resources/index.js';
import { ProjectWatcher } from './utils/file-watcher.js';

export interface ServerSetup {
  ctx: NuxtProjectContext;
  watcher: ProjectWatcher;
}

export interface ServerSetupOptions {
  allowWrites?: boolean;
}

export async function setupServer(
  server: McpServer,
  projectPath: string,
  options: ServerSetupOptions = {},
): Promise<ServerSetup> {
  const ctx = new NuxtProjectContext(projectPath, options);
  registerAllTools(server, ctx);
  registerAllResources(server, ctx);

  // Keep the cached snapshot fresh: debounce invalidations on file changes.
  // Skip the watcher under Vitest so the process can exit cleanly.
  const watcher = new ProjectWatcher(ctx.root);
  let timer: NodeJS.Timeout | undefined;
  watcher.on('change', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void ctx.invalidate();
    }, 300);
  });
  if (process.env.VITEST !== 'true' && process.env.MCP_NUXT_WATCH !== '0') {
    void watcher.start();
  }

  return { ctx, watcher };
}
