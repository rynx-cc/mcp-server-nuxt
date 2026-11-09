/**
 * Shared type definitions for the Nuxt MCP server.
 */

export interface RouteParam {
  name: string;
  optional: boolean;
  catchAll: boolean;
}

export interface RouteInfo {
  /** Resolved URL path, e.g. `/users/:id` */
  path: string;
  /** File path relative to the project root */
  file: string;
  /** Absolute file path */
  absolutePath: string;
  /** Dynamic route parameters */
  params: RouteParam[];
  /** Page meta extracted from `definePageMeta` */
  meta: Record<string, unknown>;
  /** Middleware names declared in `definePageMeta` */
  middleware: string[];
  /** Layout name declared in `definePageMeta` */
  layout?: string;
  /** True when this route has children (nested route) */
  nested: boolean;
  /** Child route paths (for nested routes) */
  children: string[];
  /** Layer name this route originates from (undefined = project root) */
  layer?: string;
}

export interface ComponentProp {
  name: string;
  type?: string;
  required: boolean;
  default?: string;
}

export interface ComponentInfo {
  /** Auto-imported component name, e.g. `BaseButton` */
  name: string;
  /** File path relative to the project root */
  file: string;
  /** Absolute file path */
  absolutePath: string;
  /** Directory the component lives in (components, pages, layouts, ...) */
  directory: string;
  props: ComponentProp[];
  emits: string[];
  slots: string[];
  autoImported: boolean;
  /** True when the component is a page route */
  isPage: boolean;
  /** Layer name this component originates from (undefined = project root) */
  layer?: string;
}

export interface ModuleInfo {
  name: string;
  version?: string;
  config?: unknown;
  status: 'active' | 'inactive';
  source: 'nuxt.config' | 'package.json' | 'both';
  /** True when the module is a local project module */
  local: boolean;
}

export type ServerRouteKind = 'api' | 'route' | 'middleware' | 'plugin';

export interface ServerRouteInfo {
  /** URL path, e.g. `/api/hello` */
  path: string;
  /** Handler file path relative to the project root */
  file: string;
  /** Absolute file path */
  absolutePath: string;
  /** HTTP method (GET/POST/... or `*` for middleware/plugins) */
  method: string;
  kind: ServerRouteKind;
  /** Middleware chain for this route */
  middleware: string[];
}

export interface ComposableInfo {
  name: string;
  /** File path relative to the project root */
  file: string;
  /** Absolute file path */
  absolutePath: string;
  parameters?: string;
  returnType?: string;
  autoImported: boolean;
  /** Directory the composable lives in */
  directory: string;
  /** Layer name this composable originates from (undefined = project root) */
  layer?: string;
}

export interface Finding {
  severity: 'error' | 'warning' | 'info';
  category: string;
  description: string;
  file?: string;
  suggestion: string;
}

export interface ProjectOverview {
  root: string;
  name: string;
  framework: string;
  nuxtVersion?: string;
  hasNuxtConfig: boolean;
  configFile?: string;
  counts: {
    routes: number;
    components: number;
    composables: number;
    serverRoutes: number;
    middleware: number;
    plugins: number;
    modules: number;
  };
  directories: string[];
  modules: string[];
  /** Names of resolved Nuxt layers (extends), highest priority first */
  layers: string[];
  /** True when the build artifacts (.nuxt) exist */
  built: boolean;
}

export interface ConfigDiff {
  key: string;
  oldValue: unknown;
  newValue: unknown;
  /** Human-readable unified diff of the config file */
  diff: string;
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
}

export interface SearchMatch {
  file: string;
  line: number;
  column: number;
  lineText: string;
  context: string[];
}

export type Severity = 'error' | 'warning' | 'info';

export interface LayerInfo {
  /** Absolute path of the layer directory */
  cwd: string;
  /** Package name or directory basename */
  name: string;
  /** Absolute path of the layer's nuxt.config, or null */
  configFile: string | null;
  /** Raw `extends` entries declared by this layer */
  extends: string[];
  /** Resolution order: 0 is the project root (highest priority) */
  priority: number;
  /** Sub-layers this layer extends (lower priority) */
  children: LayerInfo[];
}

export type AutoImportKind = 'function' | 'component' | 'value' | 'unknown';

export interface AutoImportInfo {
  /** Exported symbol name, e.g. `ref`, `useFoo`, `BaseButton` */
  name: string;
  /** Module specifier or file path the symbol comes from */
  source: string;
  kind: AutoImportKind;
  /** Type signature when present in the declaration */
  signature?: string;
}

export interface TscDiagnostic {
  file?: string;
  line?: number;
  column?: number;
  code: number;
  message: string;
  severity: 'error' | 'warning';
}
