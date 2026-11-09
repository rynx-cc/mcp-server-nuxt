/**
 * Register every nuxt:// resource against a Nuxt project context.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NuxtProjectContext } from '../context.js';
import { registerLayersResource } from './layers-graph.js';

export function registerAllResources(server: McpServer, ctx: NuxtProjectContext): void {
  registerLayersResource(server, ctx);
}
