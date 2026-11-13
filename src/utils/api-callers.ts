/**
 * Static caller analysis for server API routes. Resolves a target file/URL to
 * a Nitro handler (reusing listServerRoutes), then scans the app source for
 * `useFetch` / `useLazyFetch` / `$fetch` / `useAsyncData($fetch)` call sites.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ServerRouteInfo } from '../types.js';
import {
  exists,
  findFiles,
  listServerRoutes,
  relativePath,
} from './nuxt-parser.js';
import { matchPattern, specificity } from './explain-route.js';
import { resolveSourceDirs, type SourceDirs } from './source-dirs.js';

export type ApiCallerKind =
  | 'page'
  | 'component'
  | 'composable'
  | 'layout'
  | 'plugin'
  | 'middleware'
  | 'util';

export interface ApiTarget {
  file: string;
  pattern: string;
  method: string;
}

export interface ApiCaller {
  file: string;
  line: number;
  composable: string;
  url: string;
  kind: ApiCallerKind;
}

export interface ApiCallerResult {
  target: ApiTarget;
  callers: ApiCaller[];
  unresolved: Array<{ file: string; line: number; composable: string; url: string }>;
  notes: string[];
}

interface FetchCall {
  composable: string;
  line: number;
  url: string;
  template: boolean;
  unresolved: boolean;
  method?: string;
}

function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!url.startsWith('/')) url = `/${url}`;
  url = url.split('?')[0]!.split('#')[0]!;
  if (url.length > 1 && url.endsWith('/')) url = url.slice(0, -1);
  return url || '/';
}

function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === '\n') line++;
  return line;
}

function findOpenParen(src: string, from: number): number {
  let i = from;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  if (src[i] === '<') {
    let depth = 0;
    while (i < src.length) {
      if (src[i] === '<') depth++;
      else if (src[i] === '>') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
      i++;
    }
    while (i < src.length && /\s/.test(src[i]!)) i++;
  }
  return src[i] === '(' ? i : -1;
}

function findMatchingParen(src: string, open: number): number {
  let depth = 0;
  let inString: string | null = null;
  let inTemplate = false;
  for (let i = open; i < src.length; i++) {
    const ch = src[i]!;
    if (inString) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (inTemplate) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '`') inTemplate = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractFirstArg(
  src: string,
  open: number,
): { url: string; template: boolean; endIdx: number } | null {
  let i = open + 1;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  const ch = src[i];

  if (ch === '"' || ch === "'") {
    let j = i + 1;
    let out = '';
    while (j < src.length) {
      const c = src[j]!;
      if (c === '\\') {
        out += c + (src[j + 1] ?? '');
        j += 2;
        continue;
      }
      if (c === ch) {
        j++;
        break;
      }
      out += c;
      j++;
    }
    return { url: out, template: false, endIdx: j };
  }

  if (ch === '`') {
    let j = i + 1;
    let raw = '';
    while (j < src.length) {
      const c = src[j]!;
      if (c === '\\') {
        raw += c + (src[j + 1] ?? '');
        j += 2;
        continue;
      }
      if (c === '`') {
        j++;
        break;
      }
      raw += c;
      j++;
    }
    return { url: raw, template: true, endIdx: j };
  }

  return null;
}

function readFirstArgRaw(src: string, open: number): string | null {
  let i = open + 1;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  let depth = 0;
  let out = '';
  for (; i < src.length; i++) {
    const c = src[i]!;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break;
      depth--;
    }
    if (c === ',' && depth === 0) break;
    out += c;
  }
  return out.trim() || null;
}

function extractMethod(src: string, from: number, close: number): string | undefined {
  const end = close === -1 ? src.length : close;
  const match = src.slice(from, end).match(/\bmethod\s*:\s*["']([^"']+)["']/);
  return match?.[1]!.toUpperCase();
}

const CALL_RE = /\b(useFetch|useLazyFetch|useAsyncData|useLazyAsyncData)\b|\$fetch\b/g;

function findInnerFetch(
  src: string,
  start: number,
  end: number,
): { url: string; template: boolean; unresolved: boolean } | null {
  const re = /\$fetch\b/g;
  re.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) && m.index < end) {
    const open = findOpenParen(src, m.index + 6);
    if (open === -1 || open > end) continue;
    const arg = extractFirstArg(src, open);
    if (arg) return { url: arg.url, template: arg.template, unresolved: false };
    const raw = readFirstArgRaw(src, open);
    if (raw) return { url: raw, template: false, unresolved: true };
  }
  return null;
}

/** Extract data-fetching call sites from a source file. */
export function extractFetchCalls(content: string): FetchCall[] {
  const calls: FetchCall[] = [];
  const skipRanges: Array<[number, number]> = [];
  CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL_RE.exec(content))) {
    const name = m[0]!;
    const nameStart = m.index;
    if (skipRanges.some(([s, e]) => nameStart >= s && nameStart < e)) continue;

    const open = findOpenParen(content, nameStart + name.length);
    if (open === -1) continue;

    if (name === 'useAsyncData' || name === 'useLazyAsyncData') {
      const close = findMatchingParen(content, open);
      if (close === -1) continue;
      const inner = findInnerFetch(content, open, close);
      if (inner) {
        skipRanges.push([open, close]);
        calls.push({
          composable: name,
          line: lineOf(content, nameStart),
          url: inner.url,
          template: inner.template,
          unresolved: inner.unresolved,
        });
      }
      continue;
    }

    const arg = extractFirstArg(content, open);
    if (arg) {
      const close = findMatchingParen(content, open);
      calls.push({
        composable: name,
        line: lineOf(content, nameStart),
        url: arg.url,
        template: arg.template,
        unresolved: false,
        method: extractMethod(content, arg.endIdx, close),
      });
    } else {
      const raw = readFirstArgRaw(content, open);
      calls.push({
        composable: name,
        line: lineOf(content, nameStart),
        url: raw ?? '(unknown)',
        template: false,
        unresolved: true,
      });
    }
  }
  return calls;
}

function templateToPattern(template: string): string | null {
  if (!template.includes('${')) return template;
  let out = '';
  let i = 0;
  while (i < template.length) {
    if (template[i] === '$' && template[i + 1] === '{') {
      const end = template.indexOf('}', i);
      if (end === -1) return null;
      const expr = template.slice(i + 2, end).trim();
      const ident = expr.match(/[\w$]+/g)?.pop();
      out += ':' + (ident ?? 'param');
      i = end + 1;
    } else {
      out += template[i];
      i++;
    }
  }
  return out;
}

function normalizePattern(pattern: string): string {
  return normalizeUrl(pattern);
}

function matchesTarget(call: FetchCall, target: ApiTarget): boolean {
  if (call.unresolved) return false;
  if (call.template) {
    const pattern = templateToPattern(call.url);
    if (pattern === null) return false;
    return normalizePattern(pattern) === normalizePattern(target.pattern);
  }
  return matchPattern(target.pattern, call.url) !== null;
}

/** Resolve a file path or concrete URL to a server API route. */
export function resolveApiTarget(
  target: string,
  serverRoutes: ServerRouteInfo[],
): ApiTarget | null {
  const trimmed = target.trim();
  const apiRoutes = serverRoutes.filter((r) => r.kind === 'api' || r.kind === 'route');

  // A concrete URL also starts with `/`, so don't treat bare absolute-looking
  // paths as files — require a handler extension or the `server/` directory.
  const looksLikeFile =
    /\.(ts|js|mts|mjs)$/.test(trimmed) || trimmed.includes('server/');

  if (looksLikeFile) {
    const normalized = trimmed.replace(/\\/g, '/');
    const abs = path.isAbsolute(normalized) ? path.resolve(normalized) : null;
    const match = apiRoutes.find(
      (r) =>
        r.file === normalized ||
        (abs !== null && r.absolutePath === abs) ||
        normalized.endsWith(r.file) ||
        r.file.endsWith(normalized),
    );
    return match
      ? { file: match.file, pattern: match.path, method: match.method }
      : null;
  }

  const url = normalizeUrl(trimmed);
  const matches = apiRoutes
    .map((route) => ({ route, params: matchPattern(route.path, url) }))
    .filter((x) => x.params !== null);
  if (matches.length === 0) return null;
  matches.sort((a, b) => specificity(b.route.path) - specificity(a.route.path));
  const best = matches[0]!.route;
  return { file: best.file, pattern: best.path, method: best.method };
}

async function buildScanTargets(
  root: string,
  dirs: SourceDirs,
): Promise<Array<{ dir: string; kind: ApiCallerKind }>> {
  const app = path.join(root, 'app');
  const entries: Array<[string, ApiCallerKind]> = [
    [dirs.pagesDir, 'page'],
    [dirs.componentsDir, 'component'],
    [dirs.composablesDir, 'composable'],
    [dirs.utilsDir, 'util'],
    [dirs.layoutsDir, 'layout'],
    [dirs.pluginsDir, 'plugin'],
    [dirs.middlewareDir, 'middleware'],
    [path.join(app, 'pages'), 'page'],
    [path.join(app, 'components'), 'component'],
    [path.join(app, 'composables'), 'composable'],
    [path.join(app, 'utils'), 'util'],
    [path.join(app, 'layouts'), 'layout'],
    [path.join(app, 'plugins'), 'plugin'],
    [path.join(app, 'middleware'), 'middleware'],
  ];

  const seen = new Set<string>();
  const targets: Array<{ dir: string; kind: ApiCallerKind }> = [];
  for (const [dir, kind] of entries) {
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (await exists(resolved)) targets.push({ dir: resolved, kind });
  }
  return targets;
}

export async function findApiCallers(
  root: string,
  target: string,
  serverRoutes?: ServerRouteInfo[],
): Promise<ApiCallerResult> {
  const notes: string[] = [];
  const routes = serverRoutes ?? (await listServerRoutes(root));
  const resolved = resolveApiTarget(target, routes);

  if (!resolved) {
    return {
      target: { file: '', pattern: '', method: '' },
      callers: [],
      unresolved: [],
      notes: [`Could not resolve "${target}" to a server API route.`],
    };
  }

  const dirs = await resolveSourceDirs(root);
  const scanTargets = await buildScanTargets(root, dirs);
  const callers: ApiCaller[] = [];
  const unresolved: ApiCallerResult['unresolved'] = [];

  for (const { dir, kind } of scanTargets) {
    const vue = kind === 'page' || kind === 'component' || kind === 'layout';
    const patterns = vue ? ['**/*.vue'] : ['**/*.{ts,js,mts,mjs}'];
    const files = await findFiles(dir, patterns, ['**/*.d.ts', '**/*.d.mts', '**/*.d.cts']);
    for (const file of files) {
      const content = await fs.readFile(file, 'utf8').catch(() => '');
      for (const call of extractFetchCalls(content)) {
        if (!matchesTarget(call, resolved)) {
          if (call.unresolved) {
            unresolved.push({
              file: relativePath(root, file),
              line: call.line,
              composable: call.composable,
              url: call.url,
            });
          }
          continue;
        }

        const callerMethod = (call.method ?? 'GET').toUpperCase();
        const routeMethod = resolved.method === '*' ? '*' : resolved.method.toUpperCase();
        if (routeMethod !== '*' && callerMethod !== routeMethod) {
          notes.push(
            `${relativePath(root, file)}:${call.line} calls ${resolved.pattern} with method ${callerMethod}, but the handler is ${routeMethod}; not counted as a caller.`,
          );
          continue;
        }

        callers.push({
          file: relativePath(root, file),
          line: call.line,
          composable: call.composable,
          url: call.url,
          kind,
        });
      }
    }
  }

  callers.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  unresolved.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  return { target: resolved, callers, unresolved, notes };
}
