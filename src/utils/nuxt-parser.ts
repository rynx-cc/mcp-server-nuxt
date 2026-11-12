/**
 * Core project parsing: routes, components, composables, server routes,
 * module discovery and code search. All functions are heuristic but follow
 * Nuxt's documented conventions closely.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { resolveSourceDirs } from './source-dirs.js';
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

/** Convert a file basename to camelCase, preserving the first word (e.g. use-my-counter -> useMyCounter). */
function camelCase(segment: string): string {
  return segment
    .replace(/\.(ts|js|mts|mjs)$/, '')
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((word, i) => (i === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
}

const GROUPING_FOLDER_RE = /^\(.*\)$/;

/** Split a path segment the way Nuxt's component scanner splits names. */
function splitByCase(input: string): string[] {
  if (!input || input === '.') return [];
  const parts: string[] = [];
  for (const chunk of input.split(/[/_.\-\s]+/)) {
    if (!chunk) continue;
    const words = chunk.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g);
    parts.push(...(words && words.length > 0 ? words : [chunk]));
  }
  return parts.filter(Boolean);
}

/**
 * Nuxt drops a directory prefix when it repeats the start of the filename
 * (`base/BaseButton.vue` → `BaseButton`). Grouping folders are ignored.
 */
function resolveComponentNameSegments(fileName: string, prefixParts: string[]): string[] {
  const fileNameParts = splitByCase(fileName);
  const fileNamePartsContent = fileNameParts.join('/').toLowerCase();
  const componentPrefixParts = prefixParts.filter((part) => !GROUPING_FOLDER_RE.test(part.trim()));
  const componentNameParts = componentPrefixParts.flatMap((part) => splitByCase(part));
  let index = componentPrefixParts.length - 1;
  const matchedSuffix: string[] = [];
  while (index >= 0) {
    const prefixPart = componentPrefixParts[index]!;
    matchedSuffix.unshift(...splitByCase(prefixPart).map((part) => part.toLowerCase()));
    const matchedSuffixContent = matchedSuffix.join('/');
    if (
      fileNamePartsContent === matchedSuffixContent ||
      fileNamePartsContent.startsWith(`${matchedSuffixContent}/`) ||
      (prefixPart.toLowerCase() === fileNamePartsContent && componentPrefixParts[index + 1] === prefixPart)
    ) {
      componentNameParts.length = index;
    }
    index--;
  }
  return [...componentNameParts, ...fileNameParts];
}

function pascalJoin(parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

/** Derive the auto-import name for a component under a components/ directory. */
export function componentAutoImportName(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/\.(vue|jsx|tsx)$/i, '');
  const segments = normalized.split('/').filter((segment) => segment && segment !== '.');
  const fileRaw = (segments.pop() ?? '').replace(/(?:\.(?:client|server))?(?:\.global|\.island)*$/i, '');
  const fileName = fileRaw.toLowerCase() === 'index' ? '' : fileRaw;
  const prefixParts = splitByCase(segments.filter((segment) => !GROUPING_FOLDER_RE.test(segment.trim())).join('/'));
  return pascalJoin(resolveComponentNameSegments(fileName, prefixParts));
}

/* ------------------------------------------------------------------ */
/* Route parsing                                                       */
/* ------------------------------------------------------------------ */

function convertDynamicSegment(segment: string): { path: string; param?: RouteParam; omit?: boolean } {
  // (group) route groups are omitted from the URL.
  if (/^\([^)/]+\)$/.test(segment)) return { path: '', omit: true };
  // [[...catchall]] -> optional catch-all. Checked before [[optional]].
  const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
  if (optionalCatchAll) {
    const name = optionalCatchAll[1]!;
    return { path: `:${name}(.*)*?`, param: { name, optional: true, catchAll: true } };
  }
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
    const { path: converted, param, omit } = convertDynamicSegment(segment);
    if (omit || converted === '') continue;
    outSegments.push(converted);
    if (param) params.push(param);
  }

  return { path: '/' + outSegments.join('/'), params };
}

/** Convert a resolved route path segment back to its file-system form. */
function routeSegmentToFile(segment: string): string {
  const optionalCatchAll = segment.match(/^:(.+)\(\.\*\)\*\?$/);
  if (optionalCatchAll) return `[[...${optionalCatchAll[1]}]]`;
  const optional = segment.match(/^:(.+)\?$/);
  if (optional) return `[[${optional[1]}]]`;
  const catchAll = segment.match(/^:(.+)\(\.\*\)\*$/);
  if (catchAll) return `[...${catchAll[1]}]`;
  const dynamic = segment.match(/^:(.+)$/);
  if (dynamic) return `[${dynamic[1]}]`;
  return segment;
}

/** Inverse of `fileToRoutePath`: `/users/:id` -> `pages/users/[id].vue`. */
export function routePathToFile(routePath: string, pagesDir = 'pages'): string {
  const trimmed = routePath.replace(/^\/+|\/+$/g, '');
  if (!trimmed) return `${pagesDir}/index.vue`;
  const segments = trimmed.split('/').map(routeSegmentToFile);
  return `${pagesDir}/` + segments.join('/') + '.vue';
}

/** Convert an API path + method into a Nitro handler file: `/api/hello` + `get` -> `server/api/hello.get.ts`. */
export function routePathToNitroFile(apiPath: string, method?: string): string {
  let trimmed = apiPath.replace(/^\/+|\/+$/g, '');
  if (trimmed === 'api') trimmed = '';
  else if (trimmed.startsWith('api/')) trimmed = trimmed.slice('api/'.length);
  const segments = trimmed ? trimmed.split('/').map(routeSegmentToFile) : [];
  const base = segments.length ? segments.join('/') : 'index';
  const suffix = method && method !== '*' ? `.${method.toLowerCase()}` : '';
  return `server/api/${base}${suffix}.ts`;
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
  const dirs = await resolveSourceDirs(scanRoot);
  if (!(await exists(dirs.pagesDir))) return [];
  const files = await findFiles(dirs.pagesDir, ['**/*.vue']);
  const rels = files.map((file) => relativePath(dirs.pagesDir, file));

  const routes: RouteInfo[] = [];
  for (const file of files) {
    const rel = relativePath(dirs.pagesDir, file);
    const { path: routePath, params } = fileToRoutePath(rel);
    const content = (await readIfExists(file)) ?? '';
    const { meta, middleware, layout } = extractPageMeta(content);

    // A non-index file `users.vue` is the parent of files under `users/`.
    // `users/index.vue` is a sibling of `users/[id].vue`, and `/` is not the parent of every page.
    const withoutExt = rel.replace(/\.vue$/, '');
    const baseName = withoutExt.split('/').pop();
    const children =
      baseName && baseName !== 'index'
        ? rels
            .filter((other) => other !== rel && other.startsWith(`${withoutExt}/`))
            .map((other) => fileToRoutePath(other).path)
        : [];

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
    const dirs = await resolveSourceDirs(target.cwd);
    if (!(await exists(dirs.componentsDir))) continue;
    const files = await findFiles(dirs.componentsDir, ['**/*.vue']);
    for (const file of files) {
      if (seen.has(file)) continue;
      seen.add(file);
      const relFromComponents = relativePath(dirs.componentsDir, file);
      const name = componentAutoImportName(relFromComponents);
      if (!name) continue;
      const { props, emits, slots } = await parseVueComponent(file);
      components.push({
        name,
        file: relativePath(target.cwd, file),
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

interface NamedExport {
  name: string;
  parameters?: string;
  returnType?: string;
}

/** Named exports Nuxt would auto-import from a composable or util file. */
export function parseNamedExports(content: string): NamedExport[] {
  const found: NamedExport[] = [];
  const seen = new Set<string>();
  const push = (item: NamedExport): void => {
    if (!item.name || item.name === 'default' || seen.has(item.name)) return;
    seen.add(item.name);
    found.push(item);
  };

  for (const match of content.matchAll(
    /export\s+(?:async\s+)?function\s+([\w$]+)\s*\(([^)]*)\)\s*(?::\s*([^{=]+))?\s*\{/g,
  )) {
    push({
      name: match[1]!,
      parameters: match[2]!.trim() || undefined,
      returnType: match[3]?.trim(),
    });
  }
  for (const match of content.matchAll(/export\s+(?:async\s+)?const\s+([\w$]+)/g)) {
    push({ name: match[1]! });
  }
  for (const match of content.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const raw of match[1]!.split(',')) {
      const item = raw.trim();
      if (!item || item.startsWith('type ')) continue;
      const as = item.match(/^(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?$/);
      if (!as) continue;
      push({ name: as[2] ?? as[1]! });
    }
  }
  return found;
}

export async function listComposables(
  root: string,
  layers: Array<{ cwd: string; name: string }> = [],
): Promise<ComposableInfo[]> {
  const targets = [{ cwd: root, name: undefined as string | undefined }, ...layers.map((l) => ({ cwd: l.cwd, name: l.name }))];
  const composables: ComposableInfo[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    const dirs = await resolveSourceDirs(target.cwd);
    const groups: Array<{ dir: string; kind: 'composables' | 'utils' }> = [
      { dir: dirs.composablesDir, kind: 'composables' },
      { dir: dirs.utilsDir, kind: 'utils' },
    ];
    for (const group of groups) {
      if (!(await exists(group.dir))) continue;
      const files = await findFiles(group.dir, ['**/*.{ts,js,mts,mjs}'], ['**/*.d.ts', '**/*.d.mts', '**/*.d.cts']);
      for (const file of files) {
        if (seen.has(file)) continue;
        seen.add(file);
        const content = (await readIfExists(file)) ?? '';
        const named = parseNamedExports(content);
        const symbols =
          named.length > 0
            ? named.map((item) => ({ ...item, autoImported: true }))
            : [{ name: camelCase(path.basename(file)), parameters: undefined, returnType: undefined, autoImported: false }];
        for (const symbol of symbols) {
          composables.push({
            name: symbol.name,
            file: relativePath(target.cwd, file),
            absolutePath: file,
            parameters: symbol.parameters,
            returnType: symbol.returnType,
            autoImported: symbol.autoImported,
            directory: group.kind,
            layer: target.name,
          });
        }
      }
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

export async function listServerRoutes(
  root: string,
  layers: Array<{ cwd: string; name: string }> = [],
): Promise<ServerRouteInfo[]> {
  const targets = [{ cwd: root, name: undefined as string | undefined }, ...layers.map((layer) => ({ cwd: layer.cwd, name: layer.name }))];
  const routes: ServerRouteInfo[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    const dirs = await resolveSourceDirs(target.cwd);
    if (!(await exists(dirs.serverDir))) continue;
    const files = await findFiles(
      dirs.serverDir,
      [
        'api/**/*.{ts,js,mts,mjs}',
        'routes/**/*.{ts,js,mts,mjs}',
        'middleware/**/*.{ts,js,mts,mjs}',
        'plugins/**/*.{ts,js,mts,mjs}',
      ],
      ['**/*.d.ts', '**/*.d.mts', '**/*.d.cts'],
    );

    const globalMiddleware = files
      .filter((file) => relativePath(dirs.serverDir, file).startsWith('middleware/'))
      .map((file) => relativePath(dirs.serverDir, file).replace(/^middleware\//, '').replace(/\.(ts|js|mts|mjs)$/, ''));

    for (const file of files) {
      if (seen.has(file)) continue;
      seen.add(file);
      const fromServer = relativePath(dirs.serverDir, file);
      let kind: ServerRouteKind;
      let pathPrefix = '';

      if (fromServer.startsWith('api/')) {
        kind = 'api';
        pathPrefix = '/api';
      } else if (fromServer.startsWith('routes/')) {
        kind = 'route';
      } else if (fromServer.startsWith('middleware/')) {
        kind = 'middleware';
      } else {
        kind = 'plugin';
      }

      const inner = fromServer.replace(/^(api|routes|middleware|plugins)\//, '');
      const { path: subPath, method } = nitroPathFromFile(inner);

      routes.push({
        path:
          kind === 'middleware' || kind === 'plugin'
            ? `(global: ${inner.replace(/\.(ts|js|mts|mjs)$/, '')})`
            : pathPrefix + subPath,
        file: relativePath(target.cwd, file),
        absolutePath: file,
        method: kind === 'api' || kind === 'route' ? method : '*',
        kind,
        middleware: kind === 'middleware' || kind === 'plugin' ? [] : globalMiddleware,
        layer: target.name,
      });
    }
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
  const dirs = await resolveSourceDirs(root);
  const candidates = [
    dirs.pagesDir,
    dirs.componentsDir,
    dirs.composablesDir,
    dirs.utilsDir,
    dirs.layoutsDir,
    dirs.middlewareDir,
    dirs.pluginsDir,
    path.join(dirs.srcDir, 'assets'),
    dirs.serverDir,
    path.join(root, 'public'),
    path.join(root, 'content'),
    path.join(root, 'modules'),
    path.join(root, 'shared'),
  ];
  const existing: string[] = [];
  const seen = new Set<string>();
  for (const dir of candidates) {
    if (!(await exists(dir))) continue;
    const rel = relativePath(root, dir);
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    existing.push(rel);
  }
  return existing;
}

export async function isBuilt(root: string): Promise<boolean> {
  return exists(path.join(root, '.nuxt'));
}

/** Classify package.json dependencies into Nuxt modules vs runtime/dev deps. */
export async function analyzeBundleDeps(root: string): Promise<{
  packages: Array<{ name: string; version?: string; kind: 'nuxt-module' | 'runtime' | 'dev' | 'unknown' }>;
  warnings: string[];
}> {
  const packages: Array<{ name: string; version?: string; kind: 'nuxt-module' | 'runtime' | 'dev' | 'unknown' }> = [];
  const warnings: string[] = [];

  const raw = await readIfExists(path.join(root, 'package.json'));
  if (!raw) return { packages, warnings };

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { packages, warnings };
  }

  const dependencies = (pkg.dependencies ?? {}) as Record<string, string>;
  const devDependencies = (pkg.devDependencies ?? {}) as Record<string, string>;
  const all = new Map<string, { version: string; kind: 'runtime' | 'dev' }>();
  for (const [name, version] of Object.entries(dependencies)) all.set(name, { version, kind: 'runtime' });
  for (const [name, version] of Object.entries(devDependencies)) all.set(name, { version, kind: 'dev' });

  for (const [name, { version, kind }] of all) {
    const isModule = isNuxtModule(name);
    packages.push({ name, version, kind: isModule ? 'nuxt-module' : kind });

    if (isModule) {
      if (kind === 'runtime') {
        warnings.push(`Nuxt module "${name}" is in dependencies; it should be in devDependencies.`);
      }
      const installed = await exists(path.join(root, 'node_modules', ...name.split('/'), 'package.json'));
      if (!installed) warnings.push(`Nuxt module "${name}" is declared but not installed in node_modules.`);
    }
  }

  packages.sort((a, b) => a.name.localeCompare(b.name));
  return { packages, warnings };
}

/**
 * Read generated type artifacts from a Nuxt buildDir (project `.nuxt` or a cache dir).
 * Accepts either the buildDir itself, or a project root that contains `.nuxt/`.
 */
export async function readTypeInfo(
  typesRootOrProject: string,
  options: { projectRoot?: string } = {},
): Promise<{
  importsDts?: string;
  typesDir?: string[];
  schema?: string;
  typesRoot?: string;
}> {
  let typesRoot = typesRootOrProject;
  const directReady =
    (await exists(path.join(typesRootOrProject, 'imports.d.ts'))) ||
    (await exists(path.join(typesRootOrProject, 'tsconfig.json'))) ||
    (await exists(path.join(typesRootOrProject, 'tsconfig.app.json')));
  if (!directReady && (await exists(path.join(typesRootOrProject, '.nuxt')))) {
    typesRoot = path.join(typesRootOrProject, '.nuxt');
  }

  const result: { importsDts?: string; typesDir?: string[]; schema?: string; typesRoot?: string } = {
    typesRoot,
  };
  const importsDts =
    (await readIfExists(path.join(typesRoot, 'imports.d.ts'))) ??
    (await readIfExists(path.join(typesRoot, 'types', 'imports.d.ts')));
  if (importsDts) result.importsDts = importsDts;

  const nestedTypes = path.join(typesRoot, 'types');
  if (await exists(nestedTypes)) {
    const files = await fg(['types/**/*.d.ts'], {
      cwd: typesRoot,
      absolute: true,
      onlyFiles: true,
      dot: true,
      ignore: ['**/node_modules/**'],
    });
    const base = options.projectRoot ?? typesRootOrProject;
    result.typesDir = files.map((file) => relativePath(base, file)).sort();
  }

  const schema = await readIfExists(path.join(typesRoot, 'schema', 'nuxt.schema.json'));
  if (schema) result.schema = schema;

  return result;
}

/** Aggregate project health analysis for `analyze_project`. */
export async function analyzeProject(
  root: string,
  snapshot: {
    overview: {
      name: string;
      nuxtVersion?: string;
      hasNuxtConfig: boolean;
      counts: Record<string, number>;
      layers?: string[];
      built: boolean;
      directories: string[];
    };
    routes: unknown[];
    components: unknown[];
    modules: unknown[];
  },
  options: { limit?: number; offset?: number } = {},
): Promise<Record<string, unknown>> {
  const deps = await analyzeBundleDeps(root);
  const built = snapshot.overview.built;
  const hints: string[] = [];
  if (!built) {
    hints.push(
      'No project `.nuxt` directory (optional, not an error). Type tools auto-generate into a cache when nuxt is installed, or fall back to a scanned auto-imports registry.',
    );
  }
  if (!snapshot.overview.hasNuxtConfig) {
    hints.push('No nuxt.config.* found. Point the MCP server at a Nuxt project root.');
  }
  const offset = Math.max(0, options.offset ?? 0);
  const limit = options.limit ?? 50;
  const componentSlice = snapshot.components.slice(offset, offset + limit);
  return {
    name: snapshot.overview.name,
    nuxtVersion: snapshot.overview.nuxtVersion,
    built,
    hasNuxtConfig: snapshot.overview.hasNuxtConfig,
    counts: snapshot.overview.counts,
    layers: snapshot.overview.layers ?? [],
    directories: snapshot.overview.directories,
    modules: snapshot.modules,
    dependencies: {
      total: deps.packages.length,
      warnings: deps.warnings,
      packages: deps.packages.slice(0, limit),
    },
    components: {
      total: snapshot.components.length,
      limit,
      offset,
      truncated: offset + componentSlice.length < snapshot.components.length,
      items: componentSlice,
    },
    routes: { total: snapshot.routes.length },
    hints,
  };
}
