/**
 * Core project parsing: routes, components, composables, server routes,
 * module discovery and code search. All functions are heuristic but follow
 * Nuxt's documented conventions closely.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import type {
  ComposableInfo,
  ComponentInfo,
  ComponentProp,
  ModuleInfo,
  RouteInfo,
  RouteParam,
  SearchMatch,
  ServerRouteInfo,
  ServerRouteKind,
} from '../types.js';

const DEFAULT_IGNORE = ['**/node_modules/**', '**/.nuxt/**', '**/.output/**', '**/dist/**', '**/.git/**'];
const TEXT_EXTENSIONS = new Set([
  '.vue', '.ts', '.js', '.mts', '.mjs', '.cts', '.cjs', '.tsx', '.jsx',
  '.json', '.md', '.mdx', '.css', '.scss', '.html', '.yml', '.yaml',
]);

/* ------------------------------------------------------------------ */
/* File helpers                                                        */
/* ------------------------------------------------------------------ */

export async function findFiles(
  root: string,
  patterns: string[],
  extraIgnore: string[] = [],
): Promise<string[]> {
  const files = await fg(patterns, {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    dot: false,
    ignore: [...DEFAULT_IGNORE, ...extraIgnore],
  });
  return files.sort();
}

export function relativePath(root: string, file: string): string {
  const rel = path.relative(root, file);
  return rel.split(path.sep).join('/');
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

export async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Naming helpers                                                      */
/* ------------------------------------------------------------------ */

function pascalCase(segment: string): string {
  return segment
    .replace(/\.(vue|ts|js|mts|mjs|tsx|jsx)$/, '')
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/** Convert a file basename to camelCase, preserving the first word (e.g. use-my-counter -> useMyCounter). */
function camelCase(segment: string): string {
  return segment
    .replace(/\.(ts|js|mts|mjs)$/, '')
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((word, i) => (i === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
}

/** Derive the auto-import name for a component under a components/ directory. */
export function componentAutoImportName(relPath: string): string {
  return relPath.split('/').map(pascalCase).join('');
}

/* ------------------------------------------------------------------ */
/* Route parsing                                                       */
/* ------------------------------------------------------------------ */

function convertDynamicSegment(segment: string): { path: string; param?: RouteParam } {
  // [[optional]] -> :optional?
  const optional = segment.match(/^\[\[(.+)\]\]$/);
  if (optional) {
    return { path: `:${optional[1]}?`, param: { name: optional[1]!, optional: true, catchAll: false } };
  }
  // [...catchall] -> :catchall(.*)*
  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll) {
    return { path: `:${catchAll[1]}(.*)*`, param: { name: catchAll[1]!, optional: false, catchAll: true } };
  }
  // [dynamic] -> :dynamic
  const dynamic = segment.match(/^\[(.+)\]$/);
  if (dynamic) {
    return { path: `:${dynamic[1]}`, param: { name: dynamic[1]!, optional: false, catchAll: false } };
  }
  return { path: segment };
}

export function fileToRoutePath(relPath: string): { path: string; params: RouteParam[] } {
  const withoutExt = relPath.replace(/\.vue$/, '');
  const segments = withoutExt.split('/').filter((s) => s !== '');
  const outSegments: string[] = [];
  const params: RouteParam[] = [];

  for (const segment of segments) {
    if (segment === 'index') continue;
    const { path: converted, param } = convertDynamicSegment(segment);
    outSegments.push(converted);
    if (param) params.push(param);
  }

  return { path: '/' + outSegments.join('/'), params };
}

/** Extract layout/middleware/meta from `definePageMeta({ ... })`. */
export function extractPageMeta(content: string): {
  meta: Record<string, unknown>;
  middleware: string[];
  layout?: string;
} {
  const meta: Record<string, unknown> = {};
  let middleware: string[] = [];
  let layout: string | undefined;

  const defMatch = content.match(/definePageMeta\s*\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!defMatch) return { meta, middleware, layout };

  const body = defMatch[1]!;
  for (const line of body.split('\n')) {
    const layoutMatch = line.match(/layout\s*:\s*["']([^"']+)["']/);
    if (layoutMatch) layout = layoutMatch[1];

    const mwMatch = line.match(/middleware\s*:\s*(\[[\s\S]*?\]|["'][^"']+["'])/);
    if (mwMatch) {
      const raw = mwMatch[1]!;
      if (raw.startsWith('[')) {
        middleware = [...raw.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!);
      } else {
        middleware = [raw.replace(/["']/g, '')];
      }
    }

    const kv = line.match(/^\s*([\w$]+)\s*:\s*([\s\S]*?)\s*(?:,|$)/);
    if (kv && !['layout', 'middleware'].includes(kv[1]!)) {
      meta[kv[1]!] = kv[2]!.trim();
    }
  }
  return { meta, middleware, layout };
}

async function listRoutesIn(scanRoot: string, layer?: string): Promise<RouteInfo[]> {
  const files = await findFiles(scanRoot, ['pages/**/*.vue']);
  const byPath = new Map<string, string>();

  for (const file of files) {
    const rel = relativePath(scanRoot, file).replace(/^pages\//, '');
    byPath.set(fileToRoutePath(rel).path, file);
  }

  const routes: RouteInfo[] = [];
  for (const file of files) {
    const rel = relativePath(scanRoot, file).replace(/^pages\//, '');
    const { path: routePath, params } = fileToRoutePath(rel);
    const content = (await readIfExists(file)) ?? '';
    const { meta, middleware, layout } = extractPageMeta(content);

    // Detect nesting: a parent route `foo.vue` with `foo/bar.vue` children.
    const children = [...byPath.keys()].filter(
      (p) => p.startsWith(routePath === '/' ? '/' : routePath + '/') && p !== routePath,
    );

    routes.push({
      path: routePath,
      file: relativePath(scanRoot, file),
      absolutePath: file,
      params,
      meta,
      middleware,
      layout,
      nested: children.length > 0,
      children,
      layer,
    });
  }

  return routes;
}

export async function listPageRoutes(
  root: string,
  layers: Array<{ cwd: string; name: string }> = [],
): Promise<RouteInfo[]> {
  const targets = [{ cwd: root, name: undefined as string | undefined }, ...layers.map((l) => ({ cwd: l.cwd, name: l.name }))];
  const routes: RouteInfo[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    for (const route of await listRoutesIn(target.cwd, target.name)) {
      if (seen.has(route.absolutePath)) continue;
      seen.add(route.absolutePath);
      routes.push(route);
    }
  }

  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

/* ------------------------------------------------------------------ */
/* Component parsing                                                   */
/* ------------------------------------------------------------------ */

function parseProps(content: string): ComponentProp[] {
  const props: ComponentProp[] = [];

  // Type-based: defineProps<{ foo: string; bar?: number }>()
  const typeMatch = content.match(/defineProps\s*<\s*\{([\s\S]*?)\}\s*>/);
  if (typeMatch) {
    const body = typeMatch[1]!;
    for (const entry of splitTopLevelComma(body)) {
      const m = entry.trim().match(/^([\w$]+)(\??)\s*:\s*([\s\S]*)$/);
      if (!m) continue;
      props.push({
        name: m[1]!,
        type: m[3]!.trim(),
        required: m[2] !== '?',
      });
    }
    return props;
  }

  // Runtime: defineProps({ title: { type: String, required: true }, count: Number })
  const runtimeMatch = content.match(/defineProps\s*\(\s*\{([\s\S]*?)\}\s*\)/);
  if (runtimeMatch) {
    const body = runtimeMatch[1]!;
    for (const entry of splitTopLevelComma(body)) {
      const m = entry.trim().match(/^([\w$]+)\s*:\s*([\s\S]*)$/);
      if (!m) continue;
      const name = m[1]!;
      const value = m[2]!.trim();
      if (value.startsWith('{')) {
        const typeM = value.match(/\btype\s*:\s*([\w$[\].]+)/);
        const reqM = value.match(/\brequired\s*:\s*(true|false)/);
        const defM = value.match(/\bdefault\s*:\s*([^,}]+)/);
        props.push({
          name,
          type: typeM?.[1],
          required: reqM?.[1] === 'true',
          default: defM?.[1]?.trim(),
        });
      } else {
        props.push({ name, type: value.replace(/[()]/g, '').trim(), required: false });
      }
    }
  }
  return props;
}

function parseEmits(content: string): string[] {
  const emits: string[] = [];
  const runtimeMatch = content.match(/defineEmits\s*\(\s*\[([\s\S]*?)\]\s*\)/);
  if (runtimeMatch) {
    for (const m of runtimeMatch[1]!.matchAll(/["']([^"']+)["']/g)) emits.push(m[1]!);
    return emits;
  }
  const typeMatch = content.match(/defineEmits\s*<\s*\{([\s\S]*?)\}\s*>/);
  if (typeMatch) {
    for (const m of typeMatch[1]!.matchAll(/['"]?([\w:$-]+)['"]?\s*\(/g)) {
      if (!['on', 'call'].includes(m[1]!)) emits.push(m[1]!);
    }
  }
  return emits;
}

function parseSlots(content: string): string[] {
  const slots = new Set<string>();
  // <slot name="..."> and <slot> (default)
  for (const m of content.matchAll(/<slot(?:\s+name=["']([^"']+)["'])?[^>]*\/?>/g)) {
    slots.add(m[1] ?? 'default');
  }
  if (/\buseSlots\s*\(/.test(content)) slots.add('default');
  return [...slots];
}

function splitTopLevelComma(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export async function parseVueComponent(file: string): Promise<{
  props: ComponentProp[];
  emits: string[];
  slots: string[];
  hasScriptSetup: boolean;
}> {
  const content = (await readIfExists(file)) ?? '';
  const scriptSetup = content.match(/<script\s+setup[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '';
  const template = content.match(/<template>([\s\S]*?)<\/template>/)?.[1] ?? content;
  const combined = scriptSetup + '\n' + template;
  return {
    props: parseProps(scriptSetup || combined),
    emits: parseEmits(scriptSetup),
    slots: parseSlots(template),
    hasScriptSetup: scriptSetup.length > 0,
  };
}

export async function listComponents(
  root: string,
  layers: Array<{ cwd: string; name: string }> = [],
): Promise<ComponentInfo[]> {
  const targets = [{ cwd: root, name: undefined as string | undefined }, ...layers.map((l) => ({ cwd: l.cwd, name: l.name }))];
  const components: ComponentInfo[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    const files = await findFiles(target.cwd, ['components/**/*.vue']);
    for (const file of files) {
      if (seen.has(file)) continue;
      seen.add(file);
      const rel = relativePath(target.cwd, file);
      const relFromComponents = rel.replace(/^components\//, '');
      const { props, emits, slots } = await parseVueComponent(file);
      components.push({
        name: componentAutoImportName(relFromComponents),
        file: rel,
        absolutePath: file,
        directory: 'components',
        props,
        emits,
        slots,
        autoImported: true,
        isPage: false,
        layer: target.name,
      });
    }
  }

  return components.sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* Composable parsing                                                  */
/* ------------------------------------------------------------------ */

async function parseComposable(file: string): Promise<{ parameters?: string; returnType?: string }> {
  const content = (await readIfExists(file)) ?? '';
  const fnMatch = content.match(/export\s+(?:async\s+)?function\s+([\w$]+)\s*\(([\s\S]*?)\)\s*(?::\s*([^{=]+))?\s*\{/);
  if (!fnMatch) return {};
  const params = fnMatch[2]!.trim();
  const returnType = fnMatch[3]?.trim() ?? undefined;
  return { parameters: params || undefined, returnType };
}

export async function listComposables(
  root: string,
  layers: Array<{ cwd: string; name: string }> = [],
): Promise<ComposableInfo[]> {
  const targets = [{ cwd: root, name: undefined as string | undefined }, ...layers.map((l) => ({ cwd: l.cwd, name: l.name }))];
  const composables: ComposableInfo[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    const files = await findFiles(target.cwd, ['composables/**/*.{ts,js,mts,mjs}', 'utils/**/*.{ts,js,mts,mjs}']);
    for (const file of files) {
      if (seen.has(file)) continue;
      seen.add(file);
      const rel = relativePath(target.cwd, file);
      const dir = rel.startsWith('composables/') ? 'composables' : 'utils';
      const basename = rel.split('/').pop() ?? '';
      const name = camelCase(basename);
      const { parameters, returnType } = await parseComposable(file);
      const exported = (await readIfExists(file)) ?? '';
      const isAutoImported =
        /^use[A-Z]/.test(name) || /export\s+(?:default|const)\s+/.test(exported) || /\bautoImport\s*:\s*true/.test(exported);

      composables.push({
        name,
        file: rel,
        absolutePath: file,
        parameters,
        returnType,
        autoImported: isAutoImported,
        directory: dir,
        layer: target.name,
      });
    }
  }

  return composables.sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* Server routes                                                       */
/* ------------------------------------------------------------------ */

const METHOD_SUFFIXES: Record<string, string> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
  head: 'HEAD',
  options: 'OPTIONS',
};

function nitroPathFromFile(rel: string): { path: string; method: string } {
  const withoutExt = rel.replace(/\.(ts|js|mts|mjs)$/, '');
  const segments = withoutExt.split('/');
  const last = segments[segments.length - 1]!;
  let method = '*';
  let lastSegment = last;
  for (const [suffix, httpMethod] of Object.entries(METHOD_SUFFIXES)) {
    if (last.endsWith(`.${suffix}`)) {
      method = httpMethod;
      lastSegment = last.slice(0, -(suffix.length + 1));
      break;
    }
  }
  segments[segments.length - 1] = lastSegment;
  const converted = segments.map((s) => convertDynamicSegment(s).path);
  // Handle index files
  if (converted[converted.length - 1] === 'index') converted.pop();
  return { path: '/' + converted.join('/'), method };
}

export async function listServerRoutes(root: string): Promise<ServerRouteInfo[]> {
  const files = await findFiles(root, [
    'server/api/**/*.{ts,js,mts,mjs}',
    'server/routes/**/*.{ts,js,mts,mjs}',
    'server/middleware/**/*.{ts,js,mts,mjs}',
    'server/plugins/**/*.{ts,js,mts,mjs}',
  ]);

  const globalMiddleware = files
    .filter((f) => relativePath(root, f).startsWith('server/middleware/'))
    .map((f) => relativePath(root, f).replace(/^server\/middleware\//, '').replace(/\.(ts|js|mts|mjs)$/, ''));

  const routes: ServerRouteInfo[] = [];
  for (const file of files) {
    const rel = relativePath(root, file);
    let kind: ServerRouteKind;
    let pathPrefix = '';

    if (rel.startsWith('server/api/')) {
      kind = 'api';
      pathPrefix = '/api';
    } else if (rel.startsWith('server/routes/')) {
      kind = 'route';
    } else if (rel.startsWith('server/middleware/')) {
      kind = 'middleware';
    } else {
      kind = 'plugin';
    }

    const inner = rel.replace(/^server\/(api|routes|middleware|plugins)\//, '');
    const { path: subPath, method } = nitroPathFromFile(inner);

    routes.push({
      path: kind === 'middleware' || kind === 'plugin' ? `(global: ${inner.replace(/\.(ts|js|mts|mjs)$/, '')})` : pathPrefix + subPath,
      file: rel,
      absolutePath: file,
      method: kind === 'api' || kind === 'route' ? method : '*',
      kind,
      middleware: kind === 'middleware' || kind === 'plugin' ? [] : globalMiddleware,
    });
  }

  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

/* ------------------------------------------------------------------ */
/* Modules                                                             */
/* ------------------------------------------------------------------ */

function isNuxtModule(name: string): boolean {
  return (
    name.startsWith('@nuxt/') ||
    name.startsWith('nuxt-') ||
    name.includes('nuxt') ||
    name.startsWith('@nuxtjs/') ||
    name === 'nitro' ||
    name === '@pinia/nuxt'
  );
}

export async function listModules(root: string, configValue: Record<string, unknown>): Promise<ModuleInfo[]> {
  const result: ModuleInfo[] = [];
  const seen = new Set<string>();

  // From nuxt.config modules array
  const configModules = (configValue['modules'] as unknown[]) ?? [];
  const configModuleNames = new Set<string>();
  for (const mod of configModules) {
    if (typeof mod === 'string') {
      configModuleNames.add(mod);
      seen.add(mod);
      result.push({ name: mod, status: 'active', source: 'nuxt.config', local: false, config: undefined });
    } else if (Array.isArray(mod) && typeof mod[0] === 'string') {
      configModuleNames.add(mod[0]!);
      seen.add(mod[0]!);
      result.push({ name: mod[0]!, status: 'active', source: 'nuxt.config', local: false, config: mod[1] });
    } else if (typeof mod === 'function') {
      const name = mod.name || '(local module)';
      configModuleNames.add(name);
      seen.add(name);
      result.push({ name, status: 'active', source: 'nuxt.config', local: true, config: undefined });
    }
  }

  // From package.json
  try {
    const pkgRaw = await readIfExists(path.join(root, 'package.json'));
    if (pkgRaw) {
      const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
      const deps = { ...((pkg.dependencies as Record<string, string>) ?? {}), ...((pkg.devDependencies as Record<string, string>) ?? {}) };
      for (const [name, version] of Object.entries(deps)) {
        if (!isNuxtModule(name)) continue;
        const status = configModuleNames.has(name) ? 'active' : 'inactive';
        if (seen.has(name)) {
          const existing = result.find((m) => m.name === name);
          if (existing) {
            existing.version = version;
            existing.source = status === 'active' ? 'both' : 'package.json';
          }
        } else {
          seen.add(name);
          result.push({ name, version, status, source: 'package.json', local: false, config: undefined });
        }
      }
    }
  } catch {
    /* ignore package.json errors */
  }

  // Resolve versions for config-only modules from node_modules
  for (const mod of result) {
    if (!mod.version) {
      const pkgPath = path.join(root, 'node_modules', ...mod.name.split('/'), 'package.json');
      const raw = await readIfExists(pkgPath);
      if (raw) {
        try {
          mod.version = (JSON.parse(raw) as { version?: string }).version;
        } catch {
          /* ignore */
        }
      }
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export async function searchCode(
  root: string,
  query: string,
  fileTypes?: string[],
  maxResults = 50,
): Promise<SearchMatch[]> {
  const patterns =
    fileTypes && fileTypes.length > 0
      ? fileTypes.map((ext) => `**/*${ext.startsWith('.') ? ext : '.' + ext}`)
      : ['**/*'];
  const files = await findFiles(root, patterns, [
    '**/package-lock.json',
    '**/yarn.lock',
    '**/pnpm-lock.yaml',
    '**/bun.lockb',
  ]);
  const matches: SearchMatch[] = [];
  const regex = new RegExp(escapeRegExp(query), 'i');

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    const content = await readIfExists(file);
    if (!content) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const m = regex.exec(line);
      if (!m) continue;
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length - 1, i + 1);
      matches.push({
        file: relativePath(root, file),
        line: i + 1,
        column: m.index + 1,
        lineText: line.trim(),
        context: lines.slice(start, end + 1),
      });
      if (matches.length >= maxResults) return matches;
    }
  }
  return matches;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export async function getNuxtVersion(root: string): Promise<string | undefined> {
  const candidates = [
    path.join(root, 'node_modules', 'nuxt', 'package.json'),
    path.join(root, 'package.json'),
  ];
  for (const file of candidates) {
    const raw = await readIfExists(file);
    if (!raw) continue;
    try {
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      if (file.endsWith('node_modules/nuxt/package.json') && typeof pkg.version === 'string') {
        return pkg.version;
      }
      const deps = { ...((pkg.dependencies as Record<string, string>) ?? {}), ...((pkg.devDependencies as Record<string, string>) ?? {}) };
      const version = deps['nuxt'] ?? deps['nuxt-edge'];
      if (version) return version.replace(/[\^~]/, '');
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

export async function listDirectories(root: string): Promise<string[]> {
  const dirs = ['pages', 'components', 'composables', 'utils', 'server', 'layouts', 'middleware', 'plugins', 'assets', 'public', 'content', 'modules'];
  const existing: string[] = [];
  for (const dir of dirs) {
    if (await exists(path.join(root, dir))) existing.push(dir);
  }
  return existing;
}

export async function isBuilt(root: string): Promise<boolean> {
  return exists(path.join(root, '.nuxt'));
}

export async function readTypeInfo(root: string): Promise<{
  importsDts?: string;
  typesDir?: string[];
  schema?: string;
}> {
  const result: { importsDts?: string; typesDir?: string[]; schema?: string } = {};
  const importsDts = await readIfExists(path.join(root, '.nuxt', 'imports.d.ts'));
  if (importsDts) result.importsDts = importsDts;

  const typesDir = path.join(root, '.nuxt', 'types');
  if (await exists(typesDir)) {
    const files = await findFiles(root, ['.nuxt/types/**/*.d.ts']);
    result.typesDir = files.map((f) => relativePath(root, f)).sort();
  }

  const schema = await readIfExists(path.join(root, '.nuxt', 'schema', 'nuxt.schema.json'));
  if (schema) result.schema = schema;

  return result;
}
