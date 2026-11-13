/**
 * Static route-rules / render-mode analysis. Reads `routeRules` and
 * `nitro.routeRules` from the nuxt.config source and resolves the render mode
 * for a concrete URL the same way Nitro would (radix3-style matching, most
 * specific rule wins). No DevServer, no nuxi prepare, no `@nuxt/kit`.
 */
import { promises as fs } from 'node:fs';
import { extractConfigBody, findConfigFile } from './config-reader.js';

export interface RenderModeRuleMatch {
  pattern: string;
  rule: Record<string, unknown>;
}

export interface RenderModeCache {
  /** Seconds for `swr` (or `true` when no explicit TTL was given). */
  swr: number | boolean | null;
  /** Seconds for `isr` (or `true` when `isr: true` / never expires). */
  isr: number | boolean | null;
  /** `cache.maxAge` seconds (or a numeric `static` value). */
  maxAge: number | null;
}

export interface RenderModeResult {
  route: string;
  matchedRules: RenderModeRuleMatch[];
  mode: 'ssr' | 'spa' | 'prerender' | 'isr' | 'swr' | 'static';
  cache: RenderModeCache;
  redirect: { to: string; statusCode: number } | null;
  cors: boolean | Record<string, unknown> | null;
  headers: Record<string, unknown> | null;
  proxy: string | Record<string, unknown> | null;
  notes: string[];
}

export type RenderModeSummary = Pick<RenderModeResult, 'mode' | 'cache'>;

const RAW = '__raw';

function isRawExpression(value: unknown): value is { __raw: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === RAW && typeof (value as Record<string, unknown>)[RAW] === 'string';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !isRawExpression(value);
}

/* ------------------------------------------------------------------ */
/* Static JS literal parser                                            */
/* ------------------------------------------------------------------ */

/**
 * Parse a JS literal expression (object / array / string / number / boolean /
 * null / undefined). Anything that is not statically evaluable becomes a
 * `{ __raw: "..." }` marker and is recorded in `unresolved`.
 */
function parseJsLiteral(input: string): { value: unknown; unresolved: string[] } {
  const src = input;
  const unresolved: string[] = [];
  let i = 0;

  function skipWs(): void {
    while (i < src.length) {
      const ch = src[i]!;
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      if (ch === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== '\n') i++;
        continue;
      }
      if (ch === '/' && src[i + 1] === '*') {
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      break;
    }
  }

  function rawMarker(raw: string): { __raw: string } {
    unresolved.push(raw);
    return { [RAW]: raw };
  }

  function readString(quote: string): string {
    i++; // opening quote
    let out = '';
    while (i < src.length) {
      const ch = src[i]!;
      if (ch === '\\') {
        const next = src[i + 1];
        const escapes: Record<string, string> = {
          n: '\n',
          t: '\t',
          r: '\r',
          "'": "'",
          '"': '"',
          '`': '`',
          '\\': '\\',
          '/': '/',
        };
        out += next ? (escapes[next] ?? next) : '';
        i += 2;
        continue;
      }
      if (ch === quote) {
        i++;
        return out;
      }
      out += ch;
      i++;
    }
    return out;
  }

  function readTemplate(): unknown {
    i++; // opening backtick
    let raw = '';
    let interpolated = false;
    while (i < src.length) {
      const ch = src[i]!;
      if (ch === '\\') {
        raw += ch + (src[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (ch === '`') {
        i++;
        break;
      }
      if (ch === '$' && src[i + 1] === '{') interpolated = true;
      raw += ch;
      i++;
    }
    if (interpolated) return rawMarker(`\`${raw}\``);
    return raw;
  }

  /** Read an identifier / number / arbitrary expression until a top-level delimiter. */
  function readExpression(): string {
    const start = i;
    let depth = 0;
    let inString: string | null = null;
    let inTemplate = false;
    while (i < src.length) {
      const ch = src[i]!;
      if (inString) {
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === inString) inString = null;
        i++;
        continue;
      }
      if (inTemplate) {
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === '`') inTemplate = false;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch;
        i++;
        continue;
      }
      if (ch === '`') {
        inTemplate = true;
        i++;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') {
        depth++;
        i++;
        continue;
      }
      if (ch === ')' || ch === ']' || ch === '}') {
        if (depth === 0) break;
        depth--;
        i++;
        continue;
      }
      if (depth === 0 && ch === ',') break;
      i++;
    }
    return src.slice(start, i).trim();
  }

  function readKey(): string {
    skipWs();
    const ch = src[i];
    if (ch === '"' || ch === "'") return readString(ch);
    const start = i;
    while (i < src.length && src[i] !== ':') i++;
    return src.slice(start, i).trim();
  }

  function parseValue(): unknown {
    skipWs();
    if (i >= src.length) return undefined;
    const ch = src[i]!;
    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (ch === '"' || ch === "'") return readString(ch);
    if (ch === '`') return readTemplate();

    const raw = readExpression();
    if (raw === '') return undefined;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    if (raw === 'undefined') return undefined;
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) return Number(raw);
    return rawMarker(raw);
  }

  function parseObject(): Record<string, unknown> {
    i++; // {
    const obj: Record<string, unknown> = {};
    skipWs();
    if (src[i] === '}') {
      i++;
      return obj;
    }
    while (i < src.length) {
      skipWs();
      if (src[i] === '}') {
        i++;
        break;
      }
      const key = readKey();
      skipWs();
      if (src[i] === ':') i++;
      obj[key] = parseValue();
      skipWs();
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] === '}') {
        i++;
        break;
      }
      i++;
    }
    return obj;
  }

  function parseArray(): unknown[] {
    i++; // [
    const arr: unknown[] = [];
    skipWs();
    if (src[i] === ']') {
      i++;
      return arr;
    }
    while (i < src.length) {
      skipWs();
      if (src[i] === ']') {
        i++;
        break;
      }
      arr.push(parseValue());
      skipWs();
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] === ']') {
        i++;
        break;
      }
      i++;
    }
    return arr;
  }

  const value = parseValue();
  skipWs();
  return { value, unresolved };
}

/* ------------------------------------------------------------------ */
/* Config source extraction                                            */
/* ------------------------------------------------------------------ */

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let inString: string | null = null;
  let inTemplate = false;
  let inComment: 'line' | 'block' | null = null;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    const next = body[i + 1];

    if (inComment === 'line') {
      current += ch;
      if (ch === '\n') inComment = null;
      continue;
    }
    if (inComment === 'block') {
      current += ch;
      if (ch === '*' && next === '/') {
        current += '/';
        i++;
        inComment = null;
      }
      continue;
    }
    if (inString) {
      current += ch;
      if (ch === '\\') {
        current += next ?? '';
        i++;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (inTemplate) {
      current += ch;
      if (ch === '\\') {
        current += next ?? '';
        i++;
      } else if (ch === '`') {
        inTemplate = false;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      inComment = 'line';
      current += ch;
      continue;
    }
    if (ch === '/' && next === '*') {
      inComment = 'block';
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      current += ch;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function findTopLevelValue(body: string, key: string): string | undefined {
  for (const part of splitTopLevel(body)) {
    const match = part.match(/^\s*["']?([\w$.-]+)["']?\s*:\s*([\s\S]*)$/);
    if (match && match[1] === key) return match[2]!.trim();
  }
  return undefined;
}

interface StaticRenderConfig {
  routeRules: Record<string, unknown>;
  nitroRouteRules: Record<string, unknown>;
  globalSpa: boolean;
  notes: string[];
}

async function readStaticRenderConfig(root: string): Promise<StaticRenderConfig> {
  const notes: string[] = [];
  const configPath = findConfigFile(root);
  if (!configPath) {
    return {
      routeRules: {},
      nitroRouteRules: {},
      globalSpa: false,
      notes: ['No nuxt.config file found; assuming default SSR rendering.'],
    };
  }

  const source = await fs.readFile(configPath, 'utf8');
  const body = extractConfigBody(source);
  if (!body) {
    return {
      routeRules: {},
      nitroRouteRules: {},
      globalSpa: false,
      notes: ['Could not locate defineNuxtConfig({...}) in nuxt.config.'],
    };
  }

  const parseTopKey = (key: string): { value: unknown; unresolved: string[] } => {
    const raw = findTopLevelValue(body, key);
    if (raw === undefined) return { value: undefined, unresolved: [] };
    return parseJsLiteral(raw);
  };

  const routeRulesParsed = parseTopKey('routeRules');
  const nitroParsed = parseTopKey('nitro');
  const ssrParsed = parseTopKey('ssr');

  const routeRules: Record<string, unknown> = {};
  if (routeRulesParsed.value !== undefined) {
    if (isPlainObject(routeRulesParsed.value)) {
      Object.assign(routeRules, routeRulesParsed.value);
    } else {
      notes.push('`routeRules` is not a statically evaluable object literal; render mode may be incomplete.');
    }
  }

  const nitroRouteRules: Record<string, unknown> = {};
  if (nitroParsed.value !== undefined) {
    if (isPlainObject(nitroParsed.value)) {
      const rr = (nitroParsed.value as Record<string, unknown>)['routeRules'];
      if (isPlainObject(rr)) {
        Object.assign(nitroRouteRules, rr);
      } else if (rr !== undefined) {
        notes.push('`nitro.routeRules` is not a statically evaluable object literal; render mode may be incomplete.');
      }
    } else {
      notes.push('`nitro` is not a statically evaluable object literal; `nitro.routeRules` could not be read.');
    }
  }

  for (const expr of [...routeRulesParsed.unresolved, ...nitroParsed.unresolved]) {
    notes.push(`Unresolved expression in route rules: ${expr}`);
  }

  return { routeRules, nitroRouteRules, globalSpa: ssrParsed.value === false, notes };
}

/* ------------------------------------------------------------------ */
/* Nitro route-rule matching                                           */
/* ------------------------------------------------------------------ */

function normalizePath(input: string): string {
  let url = input.trim();
  if (!url.startsWith('/')) url = `/${url}`;
  url = url.split('?')[0]!.split('#')[0]!;
  if (url.length > 1 && url.endsWith('/')) url = url.slice(0, -1);
  return url || '/';
}

function patternSegments(pattern: string): string[] {
  return normalizePath(pattern).split('/').filter(Boolean);
}

function routeSegments(route: string): string[] {
  const path = normalizePath(route);
  return path === '/' ? [] : path.split('/').filter(Boolean);
}

function matchSegments(pattern: string[], route: string[], pi: number, ri: number): boolean {
  while (pi < pattern.length) {
    const seg = pattern[pi]!;
    if (seg === '**') {
      for (let k = ri; k <= route.length; k++) {
        if (matchSegments(pattern, route, pi + 1, k)) return true;
      }
      return false;
    }
    if (ri >= route.length) return false;
    if (seg === '*' || seg.startsWith(':')) {
      pi++;
      ri++;
      continue;
    }
    if (seg !== route[ri]) return false;
    pi++;
    ri++;
  }
  return ri === route.length;
}

/** Match a Nitro route rule pattern (`/path`, `/path/*`, `/path/**`) against a URL. */
export function matchRouteRulePattern(pattern: string, route: string): boolean {
  return matchSegments(patternSegments(pattern), routeSegments(route), 0, 0);
}

function routeRuleSpecificity(pattern: string): number {
  let score = 0;
  for (const seg of patternSegments(pattern)) {
    if (seg === '**') score += 1;
    else if (seg === '*' || seg.startsWith(':')) score += 10;
    else score += 100;
  }
  return score + patternSegments(pattern).length;
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = deepMerge(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function mergeRuleMaps(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [pattern, rule] of Object.entries(override)) {
    const existing = out[pattern];
    if (isPlainObject(existing) && isPlainObject(rule)) {
      out[pattern] = deepMerge(existing, rule);
    } else {
      out[pattern] = rule;
    }
  }
  return out;
}

function isEnabled(value: unknown): boolean {
  if (isRawExpression(value)) return false;
  return value !== undefined && value !== null && value !== false;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function explainRenderMode(root: string, route: string): Promise<RenderModeResult> {
  const notes: string[] = [];
  const url = normalizePath(route);
  const { routeRules, nitroRouteRules, globalSpa, notes: configNotes } = await readStaticRenderConfig(root);
  notes.push(...configNotes);

  const combined = mergeRuleMaps(routeRules, nitroRouteRules);

  const matched = Object.entries(combined)
    .filter(([pattern]) => matchRouteRulePattern(pattern, url))
    .map(([pattern, rule]) => ({ pattern, rule }));

  // Nitro merges least-specific first, most-specific last (`defu`).
  matched.sort((a, b) => routeRuleSpecificity(a.pattern) - routeRuleSpecificity(b.pattern));

  let merged: Record<string, unknown> = {};
  const matchedRules: RenderModeRuleMatch[] = [];
  for (const match of matched) {
    matchedRules.push({ pattern: match.pattern, rule: match.rule as Record<string, unknown> });
    if (isPlainObject(match.rule)) {
      merged = deepMerge(merged, match.rule);
    } else {
      notes.push(`Matched rule "${match.pattern}" is not a statically evaluable object literal; excluded from merge.`);
    }
  }

  if (matchedRules.length === 0) {
    notes.push(`No routeRules matched "${url}".`);
  }
  if (globalSpa) {
    notes.push('Global `ssr: false` detected; SPA is the default unless a route rule overrides it.');
  }

  const cache = merged['cache'];
  const cacheObj = isPlainObject(cache) ? cache : {};
  const swr = merged['swr'];
  const isr = merged['isr'];
  const staticRule = merged['static'];

  const cacheInfo: RenderModeCache = {
    swr: typeof swr === 'number' ? swr : swr === true ? true : null,
    isr: typeof isr === 'number' ? isr : isr === true ? true : null,
    maxAge:
      typeof cacheObj['maxAge'] === 'number'
        ? (cacheObj['maxAge'] as number)
        : typeof staticRule === 'number'
          ? staticRule
          : null,
  };
  if (cacheObj['swr'] === true && cacheInfo.swr === null) cacheInfo.swr = true;

  let mode: RenderModeResult['mode'];
  if (merged['prerender'] === true) {
    mode = 'prerender';
  } else if (isEnabled(staticRule) || cacheObj['static'] === true) {
    mode = 'static';
  } else if (isEnabled(isr)) {
    mode = 'isr';
  } else if (isEnabled(swr) || cacheObj['swr'] === true) {
    mode = 'swr';
  } else if (merged['ssr'] === false) {
    mode = 'spa';
  } else if (merged['ssr'] === true) {
    mode = 'ssr';
  } else if (globalSpa) {
    mode = 'spa';
  } else {
    mode = 'ssr';
  }

  const redirect = merged['redirect'];
  let redirectOut: RenderModeResult['redirect'] = null;
  if (typeof redirect === 'string') {
    redirectOut = { to: redirect, statusCode: 302 };
  } else if (isPlainObject(redirect)) {
    redirectOut = {
      to: typeof redirect['to'] === 'string' ? redirect['to'] : '',
      statusCode: typeof redirect['statusCode'] === 'number' ? redirect['statusCode'] : 302,
    };
  }

  const cors = merged['cors'];
  const corsOut: RenderModeResult['cors'] =
    cors === undefined || cors === null ? null : isPlainObject(cors) ? cors : Boolean(cors);

  const headers = merged['headers'];
  const headersOut: RenderModeResult['headers'] = isPlainObject(headers) ? headers : null;

  const proxy = merged['proxy'];
  const proxyOut: RenderModeResult['proxy'] =
    proxy === undefined || proxy === null ? null : isPlainObject(proxy) ? proxy : String(proxy);

  return {
    route: url,
    matchedRules,
    mode,
    cache: cacheInfo,
    redirect: redirectOut,
    cors: corsOut,
    headers: headersOut,
    proxy: proxyOut,
    notes,
  };
}

/** Compact summary used by `explain_route` (mode + cache only). */
export async function getRenderModeSummary(root: string, route: string): Promise<RenderModeSummary> {
  const result = await explainRenderMode(root, route);
  return { mode: result.mode, cache: result.cache };
}
