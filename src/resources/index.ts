/**
 * Register every nuxt:// resource against a Nuxt project context.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NuxtProjectContext } from '../context.js';
import { registerLayersResource } from './layers-graph.js';
import { registerAutoImportsResource } from './auto-imports.js';
import { registerProjectStructureResource } from './project-structure.js';
import { registerRouteMapResource } from './route-map.js';
import { registerNuxtConfigResource } from './nuxt-config.js';
import { registerModuleGraphResource } from './module-graph.js';

export function registerAllResources(server: McpServer, ctx: NuxtProjectContext): void {
  registerProjectStructureResource(server, ctx);
  registerRouteMapResource(server, ctx);
  registerNuxtConfigResource(server, ctx);
  registerModuleGraphResource(server, ctx);
  registerLayersResource(server, ctx);
  registerAutoImportsResource(server, ctx);
}
