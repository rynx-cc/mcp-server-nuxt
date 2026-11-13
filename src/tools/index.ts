/**
 * Register every MCP tool and resource against a Nuxt project context.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NuxtProjectContext } from '../context.js';
import { registerOverviewTools } from './project-overview.js';
import { registerRouteTools } from './routes.js';
import { registerComponentTools } from './components.js';
import { registerComposableTools } from './composables.js';
import { registerServerApiTools } from './server-api.js';
import { registerModuleTools } from './modules.js';
import { registerPageTools } from './pages.js';
import { registerConfigTools } from './config.js';
import { registerSearchTools } from './search.js';
import { registerLayerTools } from './layers.js';
import { registerDiagnosticTools } from './diagnostics.js';
import { registerRenderModeTools } from './render-mode.js';
import { registerApiCallerTools } from './api-callers.js';

export function registerAllTools(server: McpServer, ctx: NuxtProjectContext): void {
  registerOverviewTools(server, ctx);
  registerRouteTools(server, ctx);
  registerComponentTools(server, ctx);
  registerComposableTools(server, ctx);
  registerServerApiTools(server, ctx);
  registerModuleTools(server, ctx);
  registerPageTools(server, ctx);
  registerConfigTools(server, ctx);
  registerSearchTools(server, ctx);
  registerLayerTools(server, ctx);
  registerDiagnosticTools(server, ctx);
  registerRenderModeTools(server, ctx);
  registerApiCallerTools(server, ctx);
}
