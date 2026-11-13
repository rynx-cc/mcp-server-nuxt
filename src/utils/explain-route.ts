/**
 * Explain how Nuxt would resolve a concrete URL path to pages, layout,
 * middleware and data-fetching calls — static analysis only.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RouteInfo, ServerRouteInfo } from '../types.js';
import { exists, extractPageMeta, fileToRoutePath, findFiles, relativePath } from './nuxt-parser.js';
import { resolveSourceDirs } from './source-dirs.js';
import { getRenderModeSummary, type RenderModeSummary } from './render-mode.js';

export interface ExplainRoutePage {
  file: string;
  routeName: string;
  pattern: string;
  params: Record<string, string | string[]>;
}

export interface ExplainRouteLayout {
  name: string | false;
  file: string | null;
}

export interface ExplainRouteMiddleware {
  name: string;
  type: 'global' | 'named' | 'inline';
  file: string | null;
}

export interface ExplainRouteDataFetch {
  composable: string;
  keyOrUrl?: string;
  line: number;
  file: string;
}

export interface ExplainRouteResult {
  matched: boolean;
  page: ExplainRoutePage | null;
  parents: Array<{ file: string; pattern: string }>;
  layout: ExplainRouteLayout | null;
  middleware: ExplainRouteMiddleware[];
  dataFetching: ExplainRouteDataFetch[];
  serverRoutes: Array<{ url: string; file: string; method: string }>;
  renderMode: RenderModeSummary;
  notes: string[];
  alternatives?: Array<{ pattern: string; file: string }>;
}

function normalizeUrl(route: string): string {
  let url = route.trim();
  if (!url.startsWith('/')) url = `/${url}`;
  // strip query/hash
  url = url.split('?')[0]!.split('#')[0]!;
  if (url.length > 1 && url.endsWith('/')) url = url.slice(0, -1);
  return url || '/';
}

/** Build a matcher for a Nuxt-style pattern produced by fileToRoutePath. */
export function matchPattern(
  pattern: string,
  url: string,
): Record<string, string | string[]> | null {
  const path = normalizeUrl(url);
  const patternNorm = pattern === '/' ? '/' : pattern.replace(/\/$/, '') || '/';

  if (patternNorm === '/' && path === '/') return {};

  const parts = patternNorm.split('/').filter(Boolean);
  const urlParts = path === '/' ? [] : path.split('/').filter(Boolean);
  const params: Record<string, string | string[]> = {};
  let ui = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const optionalCatchAll = part.match(/^:(.+)\(\.\*\)\*\?$/);
    const catchAll = part.match(/^:(.+)\(\.\*\)\*$/);
    const optional = part.match(/^:(.+)\?$/);
    const dynamic = part.match(/^:(.+)$/);

    if (optionalCatchAll) {
      const name = optionalCatchAll[1]!;
      const rest = urlParts.slice(ui);
      params[name] = rest.length ? rest : [];
      ui = urlParts.length;
      continue;
    }
    if (catchAll) {
      const name = catchAll[1]!;
      const rest = urlParts.slice(ui);
      if (rest.length === 0 && i === parts.length - 1) return null;
      params[name] = rest;
      ui = urlParts.length;
      continue;
    }
    if (optional) {
      const name = optional[1]!;
      if (ui < urlParts.length) {
        params[name] = urlParts[ui]!;
        ui++;
      }
      continue;
    }
    if (dynamic) {
      if (ui >= urlParts.length) return null;
      params[dynamic[1]!] = urlParts[ui]!;
      ui++;
      continue;
    }
    // static
    if (ui >= urlParts.length || urlParts[ui] !== part) return null;
    ui++;
  }

  if (ui !== urlParts.length) return null;
  return params;
}

/** Prefer more specific (fewer catch-alls / optionals, more static segments). */
export function specificity(pattern: string): number {
  const parts = pattern.split('/').filter(Boolean);
  let score = 0;
  for (const part of parts) {
    if (/^\(.*\)\*$/.test(part) || part.includes('(.*)*')) score += 1;
    else if (part.endsWith('?') || part.startsWith(':')) score += 10;
    else score += 100;
  }
  return score + parts.length;
}

export function routeNameFromFile(relFile: string): string {
  return relFile
    .replace(/^(app\/)?pages\//, '')
    .replace(/\.vue$/, '')
    .replace(/\[\[\.\.\.([^\]]+)\]\]/g, '$1')
    .replace(/\[\.\.\.([^\]]+)\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/\//g, '-')
    .replace(/index$/, '')
    .replace(/-$/, '') || 'index';
}

const DATA_FETCH_RE =
  /\b(useFetch|useLazyFetch|useAsyncData|useLazyAsyncData|\$fetch)\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`]+)\2/g;

export function findDataFetching(content: string, file: string): ExplainRouteDataFetch[] {
  const results: ExplainRouteDataFetch[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    DATA_FETCH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DATA_FETCH_RE.exec(line))) {
      results.push({
        composable: m[1]!,
        keyOrUrl: m[3],
        line: i + 1,
        file,
      });
    }
    // useAsyncData('key', () => ...) without URL in first arg as string only
    const asyncKey = line.match(/\b(useAsyncData|useLazyAsyncData)\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (asyncKey && !results.some((r) => r.line === i + 1 && r.composable === asyncKey[1])) {
      results.push({
        composable: asyncKey[1]!,
        keyOrUrl: asyncKey[2],
        line: i + 1,
        file,
      });
    }
  }
  return results;
}

async function listAppMiddleware(
  root: string,
): Promise<Array<{ name: string; file: string; global: boolean }>> {
  const dirs = await resolveSourceDirs(root);
  if (!(await exists(dirs.middlewareDir))) return [];
  const files = await findFiles(dirs.middlewareDir, ['**/*.{ts,js,mts,mjs}']);
  return files
    .map((file) => {
      const rel = relativePath(dirs.middlewareDir, file);
      const base = rel.replace(/\.(ts|js|mts|mjs)$/, '');
      const global = /\.global$/.test(base);
      const name = base.replace(/\.global$/, '').split('/').pop()!;
      return { name, file: relativePath(root, file), global };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

async function resolveLayout(
  root: string,
  layoutName: string | undefined,
  layoutDisabled: boolean | undefined,
): Promise<ExplainRouteLayout> {
  if (layoutDisabled) return { name: false, file: null };
  const dirs = await resolveSourceDirs(root);
  const name = layoutName ?? 'default';
  const candidates = [`${name}.vue`, `${name}.tsx`, `${name}.jsx`];
  for (const cand of candidates) {
    const abs = path.join(dirs.layoutsDir, cand);
    if (await exists(abs)) {
      return { name, file: relativePath(root, abs) };
    }
  }
  // No default layout file — still report the name Nuxt would look for
  if (!layoutName) {
    return { name: 'default', file: null };
  }
  return { name, file: null };
}

async function findNestedParents(
  root: string,
  pageFile: string,
): Promise<Array<{ file: string; pattern: string }>> {
  const dirs = await resolveSourceDirs(root);
  const pagesPrefix = relativePath(root, dirs.pagesDir);
  let rel = pageFile;
  if (rel.startsWith(pagesPrefix + '/')) rel = rel.slice(pagesPrefix.length + 1);
  // rel like users/[id].vue
  const parts = rel.split('/');
  const parents: Array<{ file: string; pattern: string }> = [];
  // For users/[id].vue → check users.vue
  for (let depth = parts.length - 1; depth >= 1; depth--) {
    const parentRel = parts.slice(0, depth).join('/') + '.vue';
    const abs = path.join(dirs.pagesDir, parentRel);
    if (await exists(abs)) {
      const { path: pattern } = fileToRoutePath(parentRel);
      parents.unshift({ file: relativePath(root, abs), pattern });
    }
  }
  return parents;
}

function suggestRoutes(url: string, routes: RouteInfo[], limit = 5): string[] {
  const needle = normalizeUrl(url).toLowerCase();
  const scored = routes.map((r) => {
    const p = r.path.toLowerCase();
    let score = 0;
    if (p.includes(needle) || needle.includes(p.replace(/:[^/]+/g, ''))) score += 5;
    const a = needle.split('/').filter(Boolean);
    const b = p.split('/').filter(Boolean);
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] === b[i] || b[i]!.startsWith(':')) score += 2;
    }
    return { path: r.path, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.path);
}

function mapApiCalls(
  fetches: ExplainRouteDataFetch[],
  serverRoutes: ServerRouteInfo[],
): Array<{ url: string; file: string; method: string }> {
  const out: Array<{ url: string; file: string; method: string }> = [];
  const seen = new Set<string>();
  for (const f of fetches) {
    const url = f.keyOrUrl;
    if (!url || !url.startsWith('/api/')) continue;
    const base = url.split('?')[0]!;
    const match = serverRoutes.find((s) => {
      if (s.kind !== 'api') return false;
      return s.path === base || s.path === base.replace(/\/$/, '');
    });
    if (match && !seen.has(match.file)) {
      seen.add(match.file);
      out.push({ url: base, file: match.file, method: match.method });
    } else if (!match && !seen.has(base)) {
      seen.add(base);
      // still report intent
      out.push({ url: base, file: '', method: '*' });
    }
  }
  return out.filter((s) => s.file);
}

export async function explainRoute(
  root: string,
  routeInput: string,
  routes: RouteInfo[],
  serverRoutes: ServerRouteInfo[] = [],
): Promise<ExplainRouteResult> {
  const notes: string[] = [];
  const url = normalizeUrl(routeInput);
  const renderMode = await getRenderModeSummary(root, url);

  const matches: Array<{ route: RouteInfo; params: Record<string, string | string[]> }> = [];
  for (const route of routes) {
    const params = matchPattern(route.path, url);
    if (params) matches.push({ route, params });
  }

  if (matches.length === 0) {
    return {
      matched: false,
      page: null,
      parents: [],
      layout: null,
      middleware: [],
      dataFetching: [],
      serverRoutes: [],
      renderMode,
      notes: [`No page matched "${url}".`, ...suggestRoutes(url, routes).map((s) => `Did you mean ${s}?`)],
    };
  }

  matches.sort((a, b) => specificity(b.route.path) - specificity(a.route.path));
  const best = matches[0]!;
  if (matches.length > 1) {
    notes.push(
      `Multiple pages match "${url}"; using most specific ${best.route.path}. Also matched: ${matches
        .slice(1)
        .map((m) => m.route.path)
        .join(', ')}`,
    );
  }

  const content = await fs.readFile(best.route.absolutePath, 'utf8').catch(() => '');
  const meta = extractPageMeta(content);
  const parents = await findNestedParents(root, best.route.file);
  const layout = await resolveLayout(root, meta.layout ?? best.route.layout, meta.layoutDisabled);

  const appMw = await listAppMiddleware(root);
  const middleware: ExplainRouteMiddleware[] = [];
  for (const g of appMw.filter((m) => m.global)) {
    middleware.push({ name: g.name, type: 'global', file: g.file });
  }
  const named = meta.middleware.length ? meta.middleware : best.route.middleware;
  for (const name of named) {
    const found = appMw.find((m) => !m.global && m.name === name);
    middleware.push({
      name,
      type: 'named',
      file: found?.file ?? null,
    });
  }
  if (meta.hasInlineMiddleware) {
    middleware.push({ name: 'inline', type: 'inline', file: best.route.file });
  }

  const filesToScan = [...parents.map((p) => p.file), best.route.file];
  const dataFetching: ExplainRouteDataFetch[] = [];
  for (const file of filesToScan) {
    const abs = path.join(root, file);
    const text = await fs.readFile(abs, 'utf8').catch(() => '');
    dataFetching.push(...findDataFetching(text, file));
  }

  const mappedApis = mapApiCalls(dataFetching, serverRoutes);

  if (layout.name !== false && !layout.file && layout.name === 'default') {
    notes.push('No layouts/default.vue found; Nuxt will render without a layout component.');
  } else if (layout.name !== false && layout.name !== 'default' && !layout.file) {
    notes.push(`Layout "${layout.name}" was requested but no matching file was found under layouts/.`);
  }

  return {
    matched: true,
    page: {
      file: best.route.file,
      routeName: routeNameFromFile(best.route.file),
      pattern: best.route.path,
      params: best.params,
    },
    parents,
    layout,
    middleware,
    dataFetching,
    serverRoutes: mappedApis,
    renderMode,
    notes,
    alternatives:
      matches.length > 1
        ? matches.slice(1).map((m) => ({ pattern: m.route.path, file: m.route.file }))
        : undefined,
  };
}
