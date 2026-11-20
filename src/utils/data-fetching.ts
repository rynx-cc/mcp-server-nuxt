/**
 * Explain data fetching: list every `useFetch` / `useLazyFetch` /
 * `useAsyncData` / `useLazyAsyncData` / `$fetch` call and flag common
 * SSR/duplicate-key/pending-state mistakes. Static analysis only.
 *
 * Call scanning reuses the low-level parsers from `api-callers.ts`, and URL
 * targets are resolved with `explain-route.ts` (the same matcher explain_route
 * uses). Setup-scope and onMounted ranges come from `ssr-safety.ts`.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RouteInfo } from '../types.js';
import {
  extractMethod,
  findInnerFetch,
  findMatchingParen,
  findOpenParen,
} from './api-callers.js';
import { explainRoute } from './explain-route.js';
import { exists, findFiles, listPageRoutes, relativePath } from './nuxt-parser.js';
import { functionDepthByLine, isInRanges, mountedRanges, scriptRanges } from './ssr-safety.js';
import { resolveSourceDirs, type SourceDirs } from './source-dirs.js';

export type FetchKind = 'useFetch' | 'useLazyFetch' | 'useAsyncData' | 'useLazyAsyncData' | '$fetch';

export interface FetchOptions {
  lazy?: boolean;
  server?: boolean;
  immediate?: boolean;
  watch?: boolean;
  pick?: string[] | boolean;
  transform?: boolean;
  default?: boolean;
}

export type DataFetchRuleId =
  | 'duplicate-key'
  | 'fetch-in-onmounted'
  | 'fetch-in-setup-top-level'
  | 'server-false-without-lazy'
  | 'missing-await-pending';

export interface DataFetchCall {
  file: string;
  line: number;
  kind: FetchKind;
  url?: string;
  key?: string;
  method?: string;
  options: FetchOptions;
}

export interface DataFetchFinding {
  file: string;
  line: number;
  ruleId: DataFetchRuleId;
  severity: 'error' | 'warning';
  reason: string;
  fix: string;
}

export interface ExplainDataFetchingTarget {
  input: string | null;
  kind: 'all' | 'url' | 'file' | 'directory';
  files: string[];
  route?: {
    file: string;
    pattern: string;
    params: Record<string, string | string[]>;
  };
}

export interface ExplainDataFetchingResult {
  target: ExplainDataFetchingTarget | null;
  calls: DataFetchCall[];
  findings: DataFetchFinding[];
  summary: {
    filesScanned: number;
    calls: number;
    findings: number;
    error: number;
    warning: number;
  };
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* Call extraction                                                     */
/* ------------------------------------------------------------------ */

interface RawCall {
  kind: FetchKind;
  start: number;
  line: number;
  url?: string;
  urlDynamic: boolean;
  key?: string;
  method?: string;
  options: FetchOptions;
  source: string;
}

interface Arg {
  raw: string;
  start: number;
}

const COMPOSABLE_RE = /\b(useFetch|useLazyFetch|useAsyncData|useLazyAsyncData)\b/g;
const DOLLAR_FETCH_RE = /\$fetch\b/g;

function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === '\n') line++;
  return line;
}

/** Split call arguments at top level, keeping each argument's absolute offset. */
export function splitCallArgs(src: string, open: number, close: number): Arg[] {
  const args: Arg[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const ch = src[i]!;
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      args.push({ raw: src.slice(start, i), start });
      start = i + 1;
    }
  }
  args.push({ raw: src.slice(start, close), start });
  return args;
}

function literalValue(raw: string): { value?: string; dynamic: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { dynamic: false };
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    if (trimmed.length >= 2 && trimmed.endsWith(quote)) {
      return { value: trimmed.slice(1, -1), dynamic: false };
    }
    return { value: trimmed, dynamic: true };
  }
  if (quote === '`') {
    if (trimmed.length >= 2 && trimmed.endsWith('`')) {
      const value = trimmed.slice(1, -1);
      return { value, dynamic: value.includes('${') };
    }
    return { value: trimmed, dynamic: true };
  }
  return { value: trimmed, dynamic: true };
}

function stringLiteral(raw: string): string | null {
  const trimmed = raw.trim();
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed.length < 2 || !trimmed.endsWith(quote)) return null;
  return trimmed.slice(1, -1);
}

function optionString(raw: string, name: string): string | undefined {
  const match = raw.match(new RegExp(`\\b${name}\\s*:\\s*(['"])([^'"]+)\\1`));
  return match?.[2];
}

export function parseFetchOptions(raw: string): FetchOptions {
  const options: FetchOptions = {};
  const bool = (name: 'lazy' | 'server' | 'immediate'): void => {
    const match = raw.match(new RegExp(`\\b${name}\\s*:\\s*(true|false)`));
    if (match) options[name] = match[1] === 'true';
  };
  bool('lazy');
  bool('server');
  bool('immediate');
  if (/\bwatch\s*:/.test(raw)) options.watch = true;
  if (/\btransform\s*:/.test(raw)) options.transform = true;
  if (/\bdefault\s*:/.test(raw)) options.default = true;
  const pick = raw.match(/\bpick\s*:\s*\[([^\]]*)\]/);
  if (pick) {
    options.pick = [...pick[1]!.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]!);
  } else if (/\bpick\s*:/.test(raw)) {
    options.pick = true;
  }
  return options;
}

function buildComposableCall(
  src: string,
  kind: Exclude<FetchKind, '$fetch'>,
  nameStart: number,
  open: number,
  close: number,
): RawCall {
  const args = splitCallArgs(src, open, close);
  const options: FetchOptions = {};
  let url: string | undefined;
  let urlDynamic = false;
  let key: string | undefined;
  let method: string | undefined;
  let source = '';

  if (kind === 'useFetch' || kind === 'useLazyFetch') {
    const first = args[0];
    if (first) {
      const literal = literalValue(first.raw);
      url = literal.value;
      urlDynamic = literal.dynamic;
    }
    const optionsRaw = args[1]?.raw ?? '';
    Object.assign(options, parseFetchOptions(optionsRaw));
    method = optionString(optionsRaw, 'method')?.toUpperCase();
    key = optionString(optionsRaw, 'key');
    if (kind === 'useLazyFetch') options.lazy = true;
    source = `${url ?? ''}|${method ?? 'GET'}`;
  } else {
    const first = args[0];
    const firstIsFetcher = !!first && /=>|\bfunction\b/.test(first.raw);
    let fetcher: Arg | undefined;
    let optionsRaw = '';
    if (firstIsFetcher) {
      fetcher = first;
      optionsRaw = args[1]?.raw ?? '';
    } else {
      key = first ? (stringLiteral(first.raw) ?? undefined) : undefined;
      fetcher = args[1];
      optionsRaw = args[2]?.raw ?? '';
    }
    Object.assign(options, parseFetchOptions(optionsRaw));
    if (kind === 'useLazyAsyncData') options.lazy = true;
    method = extractMethod(src, open, close)?.toUpperCase();
    let inner: ReturnType<typeof findInnerFetch> = null;
    if (fetcher) inner = findInnerFetch(src, fetcher.start, fetcher.start + fetcher.raw.length);
    if (inner) {
      url = inner.url;
      urlDynamic = inner.unresolved;
      source = inner.unresolved ? inner.url : `${inner.url}|${method ?? 'GET'}`;
    } else {
      source = (fetcher?.raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    }
  }

  return {
    kind,
    start: nameStart,
    line: lineOf(src, nameStart),
    url,
    urlDynamic,
    key,
    method,
    options,
    source,
  };
}

function buildDollarFetchCall(src: string, nameStart: number, open: number, close: number): RawCall {
  const args = splitCallArgs(src, open, close);
  const optionsRaw = args[1]?.raw ?? '';
  const first = args[0];
  const literal = first ? literalValue(first.raw) : { value: undefined, dynamic: false };
  return {
    kind: '$fetch',
    start: nameStart,
    line: lineOf(src, nameStart),
    url: literal.value,
    urlDynamic: literal.dynamic,
    method: optionString(optionsRaw, 'method')?.toUpperCase(),
    options: parseFetchOptions(optionsRaw),
    source: `${literal.value ?? ''}|${optionString(optionsRaw, 'method')?.toUpperCase() ?? 'GET'}`,
  };
}

/** Extract every data-fetching call in one file. Nested `$fetch` inside `useAsyncData` is folded into that call. */
export function extractDataFetchCalls(content: string): RawCall[] {
  const calls: RawCall[] = [];
  const skipRanges: Array<[number, number]> = [];

  COMPOSABLE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COMPOSABLE_RE.exec(content))) {
    const kind = match[1] as Exclude<FetchKind, '$fetch'>;
    const nameStart = match.index;
    const open = findOpenParen(content, nameStart + match[0].length);
    if (open === -1) continue;
    const close = findMatchingParen(content, open);
    if (close === -1) continue;
    calls.push(buildComposableCall(content, kind, nameStart, open, close));
    skipRanges.push([open, close]);
  }

  DOLLAR_FETCH_RE.lastIndex = 0;
  while ((match = DOLLAR_FETCH_RE.exec(content))) {
    const nameStart = match.index;
    if (skipRanges.some(([start, end]) => nameStart >= start && nameStart < end)) continue;
    const open = findOpenParen(content, nameStart + match[0].length);
    if (open === -1) continue;
    const close = findMatchingParen(content, open);
    if (close === -1) continue;
    calls.push(buildDollarFetchCall(content, nameStart, open, close));
  }

  return calls.sort((a, b) => a.start - b.start);
}

/* ------------------------------------------------------------------ */
/* Assignment / template context                                       */
/* ------------------------------------------------------------------ */

interface AssignmentInfo {
  names: string[];
  dataNames: string[];
  destructured: string[];
  awaited: boolean;
}

function splitComma(text: string): string[] {
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

function parseDestructured(body: string): { destructured: string[]; dataNames: string[] } {
  const destructured: string[] = [];
  const dataNames: string[] = [];
  for (const raw of splitComma(body)) {
    const part = raw.trim();
    if (!part || part.startsWith('...')) continue;
    const match = /^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?(?:\s*=[\s\S]*)?$/.exec(part);
    if (!match) continue;
    const key = match[1]!;
    if (key === 'pending' || key === 'status') destructured.push(key);
    if (key === 'data') dataNames.push(match[2] ?? key);
  }
  return { destructured, dataNames };
}

export function assignmentBefore(src: string, callStart: number): AssignmentInfo {
  const lookback = src.slice(Math.max(0, callStart - 300), callStart);
  const withoutAwait = lookback.replace(/\bawait\s*$/, '');
  const awaited = withoutAwait !== lookback;
  const tail = withoutAwait.replace(/\s+$/, '');

  const destructure = /(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*$/.exec(tail);
  if (destructure) {
    const { destructured, dataNames } = parseDestructured(destructure[1]!);
    return { names: [], dataNames, destructured, awaited };
  }

  const single = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(tail);
  if (single) {
    return { names: [single[1]!], dataNames: [single[1]!], destructured: [], awaited };
  }

  const member = /([A-Za-z_$][\w$]*)\s*\.\s*value\s*=\s*$/.exec(tail);
  if (member) {
    return { names: [member[1]!], dataNames: [member[1]!], destructured: [], awaited };
  }

  return { names: [], dataNames: [], destructured: [], awaited };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function templateText(src: string): string {
  const match = src.match(/<template\b[^>]*>([\s\S]*)<\/template\s*>/);
  return match?.[1] ?? '';
}

function renderedNames(template: string, names: string[]): string[] {
  return names.filter((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`).test(template));
}

function hasPendingCheck(content: string, assignment: AssignmentInfo): boolean {
  if (assignment.destructured.includes('pending') || assignment.destructured.includes('status')) {
    return true;
  }
  for (const name of assignment.names) {
    if (new RegExp(`\\b${escapeRegExp(name)}\\s*\\.\\s*(pending|status)\\b`).test(content)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* File discovery                                                      */
/* ------------------------------------------------------------------ */

const SOURCE_PATTERNS = ['**/*.{vue,ts,js,mts,mjs}'];
const IGNORE = ['**/*.d.ts', '**/*.d.mts', '**/*.d.cts'];

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function allProjectFiles(root: string, dirs: SourceDirs): Promise<string[]> {
  const app = path.join(root, 'app');
  const entries: Array<{ dir: string; vueOnly: boolean }> = [
    { dir: dirs.pagesDir, vueOnly: true },
    { dir: dirs.componentsDir, vueOnly: true },
    { dir: dirs.layoutsDir, vueOnly: true },
    { dir: dirs.composablesDir, vueOnly: false },
    { dir: path.join(app, 'pages'), vueOnly: true },
    { dir: path.join(app, 'components'), vueOnly: true },
    { dir: path.join(app, 'layouts'), vueOnly: true },
    { dir: path.join(app, 'composables'), vueOnly: false },
  ];
  const seen = new Set<string>();
  const files: string[] = [];
  for (const { dir, vueOnly } of entries) {
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (!(await exists(resolved))) continue;
    const patterns = vueOnly ? ['**/*.vue'] : ['**/*.{ts,js,mts,mjs}'];
    files.push(...(await findFiles(resolved, patterns, IGNORE)));
  }
  return [...new Set(files)];
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

async function resolveUrlTarget(
  root: string,
  input: string,
): Promise<{ files: string[]; route: ExplainDataFetchingTarget['route']; notes: string[] }> {
  const routes: RouteInfo[] = await listPageRoutes(root);
  const explained = await explainRoute(root, input, routes);
  if (!explained.matched || !explained.page) {
    return { files: [], route: undefined, notes: explained.notes };
  }
  const rels = [explained.page.file, ...explained.parents.map((parent) => parent.file)];
  const unique = [...new Set(rels)];
  return {
    files: unique.map((rel) => path.join(root, rel)),
    route: {
      file: explained.page.file,
      pattern: explained.page.pattern,
      params: explained.page.params,
    },
    notes: [
      `Resolved "${input}" to ${explained.page.file}${explained.parents.length ? ` plus ${explained.parents.length} parent page(s)` : ''}.`,
    ],
  };
}

export async function explainDataFetching(
  root: string,
  input?: string,
): Promise<ExplainDataFetchingResult> {
  const notes: string[] = [
    'Static heuristic analysis only. Duplicate-key checks use explicit keys; auto-generated keys are not compared.',
  ];
  const dirs = await resolveSourceDirs(root);
  let target: ExplainDataFetchingTarget | null = null;
  let files: string[] = [];

  const trimmed = input?.trim() ?? '';
  if (!trimmed) {
    files = await allProjectFiles(root, dirs);
    target = {
      input: null,
      kind: 'all',
      files: files.map((file) => relativePath(root, file)),
    };
  } else {
    const abs = path.resolve(root, trimmed);
    if (await isFile(abs)) {
      files = /\.(?:vue|ts|js|mts|mjs)$/.test(abs) ? [abs] : [];
      target = { input: trimmed, kind: 'file', files: files.map((file) => relativePath(root, file)) };
      if (files.length === 0) notes.push(`"${trimmed}" is not a Vue/TS/JS source file.`);
    } else if (await exists(abs)) {
      files = await findFiles(abs, SOURCE_PATTERNS, IGNORE);
      target = {
        input: trimmed,
        kind: 'directory',
        files: files.map((file) => relativePath(root, file)),
      };
    } else {
      const resolved = await resolveUrlTarget(root, trimmed);
      files = resolved.files;
      target = {
        input: trimmed,
        kind: 'url',
        files: files.map((file) => relativePath(root, file)),
        route: resolved.route,
      };
      notes.push(...resolved.notes);
      if (files.length === 0) {
        notes.push(`No page matched "${trimmed}".`);
      }
    }
  }

  files = [...new Set(files)].sort();
  const calls: DataFetchCall[] = [];
  const internal: Array<{ call: DataFetchCall; raw: RawCall; assignment: AssignmentInfo; content: string }> = [];
  const findings: DataFetchFinding[] = [];

  for (const file of files) {
    const rel = relativePath(root, file);
    const content = await fs.readFile(file, 'utf8').catch(() => '');
    if (!content) continue;
    const rawCalls = extractDataFetchCalls(content);
    if (rawCalls.length === 0) continue;

    const isVue = file.endsWith('.vue');
    const depths = functionDepthByLine(content);
    const mounted = isVue ? mountedRanges(content) : [];
    const scripts = isVue ? scriptRanges(content) : [];
    const template = isVue ? templateText(content) : '';

    for (const raw of rawCalls) {
      const assignment = assignmentBefore(content, raw.start);
      const call: DataFetchCall = {
        file: rel,
        line: raw.line,
        kind: raw.kind,
        options: raw.options,
      };
      if (raw.url !== undefined) call.url = raw.url;
      if (raw.key !== undefined) call.key = raw.key;
      if (raw.method !== undefined) call.method = raw.method;
      calls.push(call);
      internal.push({ call, raw, assignment, content });

      const lazy = raw.kind === 'useLazyFetch' || raw.kind === 'useLazyAsyncData' || raw.options.lazy === true;
      const onMounted = isVue && isInRanges(raw.line, mounted);
      const inScript = isVue && isInRanges(raw.line, scripts);
      const setupTopLevel = inScript && (depths[raw.line - 1] ?? 0) === 0;
      const rendered = renderedNames(
        template,
        assignment.dataNames.length > 0 ? assignment.dataNames : assignment.names,
      );

      if (
        raw.kind === '$fetch' &&
        onMounted &&
        rendered.length > 0 &&
        !findings.some((f) => f.file === rel && f.line === raw.line && f.ruleId === 'fetch-in-onmounted')
      ) {
        findings.push({
          file: rel,
          line: raw.line,
          ruleId: 'fetch-in-onmounted',
          severity: 'warning',
          reason: `$fetch runs only after mount, but "${rendered.join(', ')}" is rendered in the template, so SSR output is empty.`,
          fix: 'Use useFetch / useAsyncData for data rendered by the template, or accept a client-only loading state.',
        });
      }

      if (raw.kind === '$fetch' && isVue && inScript && setupTopLevel && assignment.awaited) {
        findings.push({
          file: rel,
          line: raw.line,
          ruleId: 'fetch-in-setup-top-level',
          severity: 'error',
          reason: 'A bare `await $fetch(...)` at setup top level runs during SSR and again during client hydration.',
          fix: 'Wrap it: `const { data } = await useAsyncData(() => $fetch(url))`, or use useFetch(url).',
        });
      }

      if (raw.options.server === false && !lazy) {
        findings.push({
          file: rel,
          line: raw.line,
          ruleId: 'server-false-without-lazy',
          severity: 'warning',
          reason: '`server: false` blocks client-side navigation until the request resolves because the call is not lazy.',
          fix: 'Use useLazyFetch / useLazyAsyncData (or `lazy: true`) when `server: false` is set.',
        });
      }

      if (lazy && !assignment.awaited && rendered.length > 0 && !hasPendingCheck(content, assignment)) {
        findings.push({
          file: rel,
          line: raw.line,
          ruleId: 'missing-await-pending',
          severity: 'warning',
          reason: `Lazy result "${rendered.join(', ')}" is rendered without checking pending / status, so the template reads undefined data.`,
          fix: 'Check `pending` / `status` (v-if or useAsyncData status) or await the lazy result.',
        });
      }
    }
  }

  // duplicate-key needs the full scanned set, not just one file.
  const keyed = internal.filter((entry) => entry.raw.key && entry.raw.source);
  const byKey = new Map<string, typeof keyed>();
  for (const entry of keyed) {
    const list = byKey.get(entry.raw.key!) ?? [];
    list.push(entry);
    byKey.set(entry.raw.key!, list);
  }
  for (const [key, group] of byKey) {
    const sources = new Set(group.map((entry) => entry.raw.source));
    if (sources.size <= 1) continue;
    for (const entry of group) {
      const others = group.filter(
        (other) => other !== entry && other.raw.source !== entry.raw.source,
      );
      if (others.length === 0) continue;
      const other = others[0]!;
      findings.push({
        file: entry.call.file,
        line: entry.call.line,
        ruleId: 'duplicate-key',
        severity: 'error',
        reason: `Key "${key}" is also used at ${other.call.file}:${other.call.line} with a different fetcher (${other.raw.source}).`,
        fix: 'Give each independent request a unique key, or share one useAsyncData / useFetch result instead of fetching twice.',
      });
    }
  }

  calls.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));
  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId),
  );

  if (findings.length === 0) {
    notes.push('No data-fetching issues found.');
  }
  if (target?.kind === 'all') {
    notes.push('Scanned pages, components, layouts and composables.');
  }

  const error = findings.filter((f) => f.severity === 'error').length;
  const warning = findings.filter((f) => f.severity === 'warning').length;

  return {
    target,
    calls,
    findings,
    summary: {
      filesScanned: files.length,
      calls: calls.length,
      findings: findings.length,
      error,
      warning,
    },
    notes,
  };
}
