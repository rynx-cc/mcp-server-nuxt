/**
 * Static Nuxt plugin injection tracing.
 *
 * Answers questions such as "Where does useNuxtApp().$api come from?" and
 * "Which files use a plugin-provided value?" by scanning plugin providers and
 * injection references in the application and resolvable local layers.
 *
 * This is read-only static analysis. It never executes plugin code, never
 * starts a dev server, and never rewrites application code or replaces Nuxt's
 * injection mechanism.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { extractConfigBody, findConfigFile } from './config-reader.js';
import { findTopLevelValue, parseJsLiteral } from './render-mode.js';
import { exists, findFiles, getNuxtVersion, relativePath } from './nuxt-parser.js';
import { resolveSourceDirs } from './source-dirs.js';
import { resolveLayers } from './layers.js';
import type { LayerInfo } from '../types.js';

export interface InjectionDiagnostic {
  severity: 'info' | 'warning';
  message: string;
}

export type InjectionScope = 'client' | 'server' | 'universal';
export type InjectionProviderForm = 'returned-provide-object' | 'provide-call';
export type InjectionReferenceKind = 'destructured' | 'member' | 'computed-member' | 'template';
export type InjectionStatus =
  | 'resolved'
  | 'unresolved'
  | 'multiple-providers'
  | 'no-static-references'
  | 'framework-provided';

export interface InjectionProvider {
  /** Public injection name, e.g. `$api`. */
  injectionName: string;
  /** Original provide key, e.g. `api`. */
  key: string;
  /** File path relative to the project root (external layers use `../`). */
  file: string;
  line: number;
  column: number;
  form: InjectionProviderForm;
  scope: InjectionScope;
  /** True when registration sits inside an `import.meta.client` / `process.client` / server guard. */
  conditional: boolean;
  /** Layer name (undefined for the project root layer). */
  layer?: string;
}

export interface InjectionReference {
  injectionName: string;
  file: string;
  line: number;
  column: number;
  kind: InjectionReferenceKind;
  /** Local alias for destructured injections, e.g. `api`. */
  alias?: string;
  /** Short source expression, e.g. `app.$api` or `$api`. */
  expression?: string;
}

export interface InjectionEntry {
  name: string;
  status: InjectionStatus;
  providers: InjectionProvider[];
  references: InjectionReference[];
  diagnostics: InjectionDiagnostic[];
}

export interface ExplainInjectionsResult {
  project: {
    root: string;
    name?: string;
    nuxtVersion?: string;
    srcDir: string;
  };
  scope: {
    layers: string[];
    scannedDirs: string[];
  };
  counts: {
    providers: number;
    references: number;
    injections: number;
    filesScanned: number;
    skipped: number;
    unreadable: number;
  };
  injections: InjectionEntry[];
  diagnostics: InjectionDiagnostic[];
  limitations: string[];
  skipped: string[];
  unreadable: string[];
}

const FRAMEWORK_INJECTIONS = new Set(['$nuxt', '$route', '$router', '$config']);
const VUE_EXT = /\.vue$/;

interface PluginTarget {
  abs: string;
  rel: string;
  layer?: string;
  mode?: 'client' | 'server' | 'all' | string;
}

interface SourceRange {
  start: number;
  end: number;
}

interface DestructuredBinding {
  name: string;
  alias?: string;
}

/* ------------------------------------------------------------------ */
/* Small string / index helpers                                       */
/* ------------------------------------------------------------------ */

export function normalizeInjectionName(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith('$') ? trimmed : `$${trimmed}`;
}

function lineCol(content: string, index: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(index, content.length);
  for (let i = 0; i < end; i++) {
    if (content[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

function skipWs(src: string, from: number): number {
  let i = from;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  return i;
}

/** Match an opening delimiter to its closing delimiter, ignoring strings/comments. */
function matchingDelim(src: string, open: number): number {
  const openCh = src[open];
  const closeCh = openCh === '(' ? ')' : openCh === '[' ? ']' : '}';
  if (!openCh || !closeCh) return -1;

  let depth = 0;
  let inString: string | null = null;
  let inTemplate = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = open; i < src.length; i++) {
    const ch = src[i]!;
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && src[i + 1] === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
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
    if (ch === '/' && src[i + 1] === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      blockComment = true;
      i++;
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
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findWord(src: string, word: string): number[] {
  const out: number[] = [];
  let i = 0;
  let inString: string | null = null;
  let inTemplate = false;
  let lineComment = false;
  let blockComment = false;

  while (i < src.length) {
    const ch = src[i]!;
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      i++;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && src[i + 1] === '/') {
        blockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
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
    if (ch === '/' && src[i + 1] === '/') {
      lineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      blockComment = true;
      i += 2;
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

    if (src.startsWith(word, i)) {
      const before = i > 0 ? src[i - 1]! : '';
      const after = src[i + word.length] ?? '';
      if (!/[A-Za-z0-9_$]/.test(before) && !/[A-Za-z0-9_$]/.test(after)) {
        out.push(i);
      }
    }
    i++;
  }
  return out;
}

/** Split on top-level commas, ignoring strings, templates and nested delimiters. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let quote: string | null = null;
  let inTemplate = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (lineComment) {
      current += ch;
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      current += ch;
      if (ch === '*' && text[i + 1] === '/') {
        current += '/';
        i++;
        blockComment = false;
      }
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += text[i + 1] ?? '';
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (inTemplate) {
      current += ch;
      if (ch === '\\') {
        current += text[i + 1] ?? '';
        i++;
      } else if (ch === '`') {
        inTemplate = false;
      }
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      lineComment = true;
      current += ch;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      blockComment = true;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
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

/** Find a top-level (depth 0) character occurrence, ignoring strings/templates. */
function findTopLevelChar(text: string, target: string): number {
  let depth = 0;
  let quote: string | null = null;
  let inTemplate = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
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
      quote = ch;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }
    if (depth === 0 && ch === target) return i;
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
  }
  return -1;
}

function unquote(text: string): string {
  const trimmed = text.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readStringLiteral(src: string, from: number): { value: string; end: number } | null {
  const i = skipWs(src, from);
  const ch = src[i];
  if (ch !== '"' && ch !== "'") return null;
  let out = '';
  for (let k = i + 1; k < src.length; k++) {
    const c = src[k]!;
    if (c === '\\') {
      out += src[k + 1] ?? '';
      k++;
      continue;
    }
    if (c === ch) return { value: out, end: k };
    out += c;
  }
  return null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inRanges(index: number, ranges: SourceRange[]): boolean {
  return ranges.some((range) => index >= range.start && index <= range.end);
}

/* ------------------------------------------------------------------ */
/* Object literal entry parsing                                       */
/* ------------------------------------------------------------------ */

interface ObjectEntry {
  kind: 'static' | 'computed' | 'spread' | 'method';
  key?: string;
  value?: string;
  keyIndex: number;
  valueIndex: number;
}

/**
 * Parse the top-level entries of an object literal's inner text.
 * `offset` is the absolute index of `text` within the original content.
 */
function parseObjectEntries(text: string, offset: number): ObjectEntry[] {
  const entries: ObjectEntry[] = [];
  const parts = splitTopLevel(text);
  let searchFrom = 0;

  for (const part of parts) {
    const idx = text.indexOf(part, searchFrom);
    if (idx < 0) continue;
    searchFrom = idx + part.length;

    const absStart = offset + idx;
    const lead = part.match(/^\s*/)?.[0].length ?? 0;
    const absTrimStart = absStart + lead;
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('...')) {
      entries.push({ kind: 'spread', keyIndex: absTrimStart, valueIndex: absTrimStart });
      continue;
    }

    if (trimmed.startsWith('[')) {
      const close = matchingDelim(trimmed, 0);
      const keyRaw = close > 0 ? trimmed.slice(1, close) : trimmed.slice(1);
      entries.push({ kind: 'computed', key: keyRaw.trim(), keyIndex: absTrimStart + 1, valueIndex: absTrimStart });
      continue;
    }

    const colon = findTopLevelChar(trimmed, ':');
    const paren = findTopLevelChar(trimmed, '(');

    if (colon === -1 && paren !== -1) {
      // Method shorthand: setup(nuxtApp) { ... }
      const name = trimmed.slice(0, paren).trim();
      entries.push({
        kind: 'method',
        key: name,
        value: trimmed.slice(paren),
        keyIndex: absTrimStart,
        valueIndex: absTrimStart + paren,
      });
      continue;
    }

    if (colon !== -1) {
      const keyText = trimmed.slice(0, colon).trim();
      const afterColon = trimmed.slice(colon + 1);
      const valueLead = afterColon.match(/^\s*/)?.[0].length ?? 0;
      entries.push({
        kind: 'static',
        key: unquote(keyText),
        value: afterColon.trim(),
        keyIndex: absTrimStart,
        valueIndex: absTrimStart + colon + 1 + valueLead,
      });
      continue;
    }

    // Shorthand identifier property: { toast }
    entries.push({
      kind: 'static',
      key: unquote(trimmed),
      value: trimmed,
      keyIndex: absTrimStart,
      valueIndex: absTrimStart,
    });
  }

  return entries;
}

/* ------------------------------------------------------------------ */
/* Plugin provider scanning                                           */
/* ------------------------------------------------------------------ */

interface FunctionLike {
  param: string | null;
  bodyStart: number;
  bodyEnd: number;
  expressionBody: boolean;
}

/** Read an arrow / function / method-like expression starting at `start`. */
function readFunctionLike(content: string, start: number): FunctionLike | null {
  let i = skipWs(content, start);
  let param: string | null = null;

  if (content.startsWith('async', i) && !/[A-Za-z0-9_$]/.test(content[i + 5] ?? '')) {
    i = skipWs(content, i + 5);
  }

  if (content.startsWith('function', i) && !/[A-Za-z0-9_$]/.test(content[i + 8] ?? '')) {
    i = skipWs(content, i + 8);
    const nameMatch = /^[A-Za-z_$][\w$]*/.exec(content.slice(i));
    if (nameMatch) i = skipWs(content, i + nameMatch[0].length);
    if (content[i] !== '(') return null;
    const close = matchingDelim(content, i);
    if (close < 0) return null;
    param = firstParam(content.slice(i + 1, close));
    i = skipWs(content, close + 1);
    if (content[i] !== '{') return null;
    const bodyEnd = matchingDelim(content, i);
    if (bodyEnd < 0) return null;
    return { param, bodyStart: i, bodyEnd, expressionBody: false };
  }

  if (content[i] === '(') {
    const close = matchingDelim(content, i);
    if (close < 0) return null;
    param = firstParam(content.slice(i + 1, close));
    i = skipWs(content, close + 1);
    if (content[i] === '=' && content[i + 1] === '>') {
      i = skipWs(content, i + 2);
      if (content[i] === '{') {
        const bodyEnd = matchingDelim(content, i);
        if (bodyEnd < 0) return null;
        return { param, bodyStart: i, bodyEnd, expressionBody: false };
      }
      return { param, bodyStart: i, bodyEnd: -1, expressionBody: true };
    }
    // Method shorthand: setup(nuxtApp) { ... }
    if (content[i] === '{') {
      const bodyEnd = matchingDelim(content, i);
      if (bodyEnd < 0) return null;
      return { param, bodyStart: i, bodyEnd, expressionBody: false };
    }
    return null;
  }

  const ident = /^[A-Za-z_$][\w$]*/.exec(content.slice(i));
  if (ident) {
    param = ident[0];
    i = skipWs(content, i + ident[0].length);
    if (content[i] !== '=' || content[i + 1] !== '>') return null;
    i = skipWs(content, i + 2);
    if (content[i] === '{') {
      const bodyEnd = matchingDelim(content, i);
      if (bodyEnd < 0) return null;
      return { param, bodyStart: i, bodyEnd, expressionBody: false };
    }
    return { param, bodyStart: i, bodyEnd: -1, expressionBody: true };
  }

  return null;
}

function firstParam(paramsText: string): string | null {
  const parts = splitTopLevel(paramsText);
  const first = parts[0]?.trim() ?? '';
  const match = /^[A-Za-z_$][\w$]*/.exec(first);
  return match ? match[0] : null;
}

function identifierBefore(src: string, index: number): string | null {
  let i = index - 1;
  while (i >= 0 && /\s/.test(src[i]!)) i--;
  if (i < 0 || src[i] !== '.') return null;
  i--;
  while (i >= 0 && /\s/.test(src[i]!)) i--;
  if (i < 0) return null;
  const match = /[A-Za-z_$][\w$]*$/.exec(src.slice(0, i + 1));
  return match ? match[0] : null;
}

function fileScope(rel: string): InjectionScope {
  if (/\.client\.(?:ts|js|mts|mjs)$/.test(rel)) return 'client';
  if (/\.server\.(?:ts|js|mts|mjs)$/.test(rel)) return 'server';
  return 'universal';
}

function guardRanges(
  content: string,
  start: number,
  end: number,
): Array<{ start: number; end: number; scope: 'client' | 'server' }> {
  const out: Array<{ start: number; end: number; scope: 'client' | 'server' }> = [];
  const re =
    /\bif\s*\(\s*(import\.meta\.client|import\.meta\.server|process\.client|process\.server)\s*\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    if (match.index < start || match.index > end) continue;
    const openBrace = match.index + match[0].length - 1;
    const close = matchingDelim(content, openBrace);
    if (close < 0) continue;
    const scope = match[1]!.includes('client') ? 'client' : 'server';
    out.push({ start: match.index, end: close, scope });
  }
  return out;
}

interface ProviderSink {
  providers: InjectionProvider[];
  limitations: string[];
}

function scanProvideProperty(
  content: string,
  openBrace: number,
  closeBrace: number,
  rel: string,
  addProvider: (key: string, absIndex: number, form: InjectionProviderForm) => void,
  limitations: string[],
): void {
  const inner = content.slice(openBrace + 1, closeBrace);
  const entries = parseObjectEntries(inner, openBrace + 1);
  const provideEntry = entries.find((entry) => entry.key === 'provide');
  if (!provideEntry) return;

  if (provideEntry.kind !== 'static' && provideEntry.kind !== 'method') {
    limitations.push(`Unsupported provide declaration in ${rel}; expected provide: { ... }.`);
    return;
  }

  const value = provideEntry.value ?? '';
  if (!value.trimStart().startsWith('{')) {
    limitations.push(
      `provide value in ${rel} is not a static object literal (imported/helper provider object); not traced.`,
    );
    return;
  }

  const valueOpen = skipWs(content, provideEntry.valueIndex);
  const valueClose = matchingDelim(content, valueOpen);
  if (valueClose < 0) {
    limitations.push(`Could not parse provide object in ${rel}.`);
    return;
  }

  const valueInner = content.slice(valueOpen + 1, valueClose);
  for (const entry of parseObjectEntries(valueInner, valueOpen + 1)) {
    if (entry.kind === 'static' && entry.key) {
      addProvider(entry.key, entry.keyIndex, 'returned-provide-object');
    } else if (entry.kind === 'computed') {
      limitations.push(`Computed provide key [${entry.key ?? ''}] in ${rel}; not traced statically.`);
    } else if (entry.kind === 'spread') {
      limitations.push(`Spread provider object in ${rel}; not traced statically.`);
    }
  }
}

function scanPluginBody(
  content: string,
  regionStart: number,
  regionEnd: number,
  param: string | null,
  target: PluginTarget,
  sink: ProviderSink,
  baseScope: InjectionScope,
): void {
  const region = content.slice(regionStart, regionEnd);
  const guards = guardRanges(content, regionStart, regionEnd);

  const addProvider = (key: string, absIndex: number, form: InjectionProviderForm): void => {
    const injectionName = normalizeInjectionName(key);
    const lc = lineCol(content, absIndex);
    const guard = guards.find((range) => absIndex >= range.start && absIndex <= range.end);
    const scope = guard ? guard.scope : baseScope;
    sink.providers.push({
      injectionName,
      key,
      file: target.rel,
      line: lc.line,
      column: lc.column,
      form,
      scope,
      conditional: guard !== undefined,
      layer: target.layer,
    });
  };

  // 1. Returned provide object: return { provide: { ... } }
  for (const r of findWord(region, 'return')) {
    const abs = regionStart + r;
    const i = skipWs(content, abs + 'return'.length);
    if (content[i] === '{') {
      const close = matchingDelim(content, i);
      if (close > 0) {
        scanProvideProperty(content, i, close, target.rel, addProvider, sink.limitations);
      }
    }
  }

  // 2. Expression-bodied plugin: () => ({ provide: { ... } })
  const trimmed = region.trim();
  if (trimmed.startsWith('(')) {
    const absOpen = regionStart + (region.length - region.trimStart().length);
    const absClose = matchingDelim(content, absOpen);
    if (absClose >= 0 && absClose <= regionEnd) {
      const innerText = content.slice(absOpen + 1, absClose).trim();
      if (innerText.startsWith('{')) {
        const openBrace = skipWs(content, absOpen + 1);
        const close = matchingDelim(content, openBrace);
        if (close > 0) {
          scanProvideProperty(content, openBrace, close, target.rel, addProvider, sink.limitations);
        }
      }
    }
  } else if (trimmed.startsWith('{')) {
    const openBrace = regionStart + (region.length - region.trimStart().length);
    const close = matchingDelim(content, openBrace);
    if (close > 0) {
      scanProvideProperty(content, openBrace, close, target.rel, addProvider, sink.limitations);
    }
  }

  // 3. ctx.provide('key', value) calls traced to the plugin context parameter.
  for (const p of findWord(region, 'provide')) {
    const abs = regionStart + p;
    const base = identifierBefore(content, abs);
    if (!param || base !== param) continue;
    const open = skipWs(content, abs + 'provide'.length);
    if (content[open] !== '(') continue;
    const argStart = skipWs(content, open + 1);
    const str = readStringLiteral(content, argStart);
    if (str) {
      addProvider(str.value, argStart, 'provide-call');
    } else {
      sink.limitations.push(
        `Dynamic/computed key in ${param}.provide() in ${target.rel}; not traced statically.`,
      );
    }
  }
}

function scanPluginFile(content: string, target: PluginTarget, sink: ProviderSink): void {
  const baseScope =
    target.mode === 'client' ? 'client' : target.mode === 'server' ? 'server' : fileScope(target.rel);

  for (const word of findWord(content, 'defineNuxtPlugin')) {
    const open = skipWs(content, word + 'defineNuxtPlugin'.length);
    if (content[open] !== '(') continue;
    const close = matchingDelim(content, open);
    if (close < 0) continue;

    const fn = readFunctionLike(content, open + 1);
    if (fn) {
      const regionStart = fn.expressionBody ? fn.bodyStart : fn.bodyStart + 1;
      const regionEnd = fn.expressionBody ? close : fn.bodyEnd;
      scanPluginBody(content, regionStart, regionEnd, fn.param, target, sink, baseScope);
      continue;
    }

    const arg = content.slice(open + 1, close).trim();
    if (arg.startsWith('{')) {
      const openBrace = skipWs(content, open + 1);
      const closeBrace = matchingDelim(content, openBrace);
      if (closeBrace < 0) {
        sink.limitations.push(`Could not parse defineNuxtPlugin object argument in ${target.rel}.`);
        continue;
      }
      const inner = content.slice(openBrace + 1, closeBrace);
      const entries = parseObjectEntries(inner, openBrace + 1);
      const setup = entries.find((entry) => entry.key === 'setup');
      if (setup && setup.kind !== 'spread' && setup.kind !== 'computed') {
        const setupFn = readFunctionLike(content, setup.valueIndex);
        if (setupFn) {
          const regionStart = setupFn.expressionBody ? setupFn.bodyStart : setupFn.bodyStart + 1;
          const regionEnd = setupFn.expressionBody ? close : setupFn.bodyEnd;
          scanPluginBody(content, regionStart, regionEnd, setupFn.param, target, sink, baseScope);
        } else {
          sink.limitations.push(`Could not parse setup function in ${target.rel}.`);
        }
      }
      continue;
    }

    sink.limitations.push(`Unsupported defineNuxtPlugin argument in ${target.rel}; not traced.`);
  }
}

/* ------------------------------------------------------------------ */
/* Injection usage scanning                                           */
/* ------------------------------------------------------------------ */

function scriptRanges(content: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  const re = /<script\b[^>]*>[\s\S]*?<\/script\s*>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function templateRanges(content: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  const re = /<template\b[^>]*>|<\/template\s*>/g;
  let match: RegExpExecArray | null;
  let depth = 0;
  let start = -1;
  while ((match = re.exec(content))) {
    if (match[0].startsWith('</')) {
      depth--;
      if (depth <= 0 && start >= 0) {
        ranges.push({ start, end: match.index + match[0].length });
        start = -1;
        depth = 0;
      }
    } else {
      if (depth === 0) start = match.index;
      depth++;
    }
  }
  if (start >= 0) {
    ranges.push({ start, end: content.length });
  }
  return ranges;
}

function matchingOpenBraceBackward(content: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    const ch = content[i]!;
    if (ch === '}') depth++;
    else if (ch === '{') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function readIdentifierBackward(content: string, eqIndex: number): { name: string; start: number } | null {
  let k = eqIndex - 1;
  while (k >= 0 && /\s/.test(content[k]!)) k--;
  const match = /[A-Za-z_$][\w$]*$/.exec(content.slice(0, k + 1));
  if (!match) return null;
  return { name: match[0], start: k + 1 - match[0].length };
}

function parseDestructureInjection(pattern: string): DestructuredBinding[] {
  const inner = pattern.slice(pattern.indexOf('{') + 1, pattern.lastIndexOf('}'));
  const out: DestructuredBinding[] = [];
  for (const raw of splitTopLevel(inner)) {
    const part = raw.trim();
    if (!part || part.startsWith('...') || part.startsWith('[')) continue;

    let key = part;
    let alias: string | undefined;
    const colon = findTopLevelChar(part, ':');
    if (colon !== -1) {
      key = part.slice(0, colon).trim();
      alias = part.slice(colon + 1).split('=')[0]!.trim();
      if (!alias) alias = undefined;
    } else {
      const eq = findTopLevelChar(part, '=');
      if (eq !== -1) key = part.slice(0, eq).trim();
    }

    key = unquote(key);
    if (key.startsWith('$')) {
      out.push({ name: normalizeInjectionName(key), alias });
    }
  }
  return out;
}

function parseChainNames(
  src: string,
  from: number,
): Array<{ name: string; kind: 'member' | 'computed-member' }> {
  const names: Array<{ name: string; kind: 'member' | 'computed-member' }> = [];
  let i = from;
  for (;;) {
    i = skipWs(src, i);
    if (src[i] === '?' && src[i + 1] === '.') i += 2;
    if (src[i] === '.') {
      i = skipWs(src, i + 1);
      const match = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      if (!match) break;
      names.push({ name: match[0], kind: 'member' });
      i += match[0].length;
      continue;
    }
    if (src[i] === '[') {
      const match = /^\[\s*(['"])(.*?)\1\s*\]/.exec(src.slice(i));
      if (!match) break;
      names.push({ name: match[2]!, kind: 'computed-member' });
      i += match[0].length;
      continue;
    }
    break;
  }
  return names;
}

interface ReferenceSink {
  addReference: (
    name: string,
    absIndex: number,
    kind: InjectionReferenceKind,
    alias?: string,
    expression?: string,
  ) => void;
}

function scanScriptReferences(
  content: string,
  ranges: SourceRange[],
  rel: string,
  sink: ReferenceSink,
): void {
  const aliases: string[] = [];
  const calls = findWord(content, 'useNuxtApp');

  for (const start of calls) {
    if (!inRanges(start, ranges)) continue;
    const open = skipWs(content, start + 'useNuxtApp'.length);
    if (content[open] !== '(') continue;
    const close = matchingDelim(content, open);
    if (close < 0) continue;
    const after = skipWs(content, close + 1);

    // Direct chain: useNuxtApp().$api(...)
    for (const name of parseChainNames(content, after)) {
      if (name.name.startsWith('$')) {
        sink.addReference(name.name, start, name.kind, undefined, `useNuxtApp().${name.name}`);
      }
    }

    // Destructuring / alias before the call.
    let i = start - 1;
    while (i >= 0 && /\s/.test(content[i]!)) i--;
    const isAssign =
      content[i] === '=' &&
      content[i - 1] !== '=' &&
      content[i - 1] !== '!' &&
      content[i - 1] !== '<' &&
      content[i - 1] !== '>' &&
      content[i + 1] !== '=';

    if (isAssign) {
      let j = i - 1;
      while (j >= 0 && /\s/.test(content[j]!)) j--;
      if (content[j] === '}') {
        const openBrace = matchingOpenBraceBackward(content, j);
        if (openBrace >= 0) {
          const before = content.slice(Math.max(0, openBrace - 20), openBrace);
          if (/(?:const|let|var)\s*$/.test(before)) {
            const pattern = content.slice(openBrace, j + 1);
            for (const binding of parseDestructureInjection(pattern)) {
              sink.addReference(binding.name, start, 'destructured', binding.alias, pattern.trim());
            }
            continue;
          }
        }
      } else {
        const ident = readIdentifierBackward(content, i);
        if (ident) {
          const beforeIdent = content.slice(Math.max(0, start - 120), ident.start);
          if (/(?:const|let|var)\s+$/.test(beforeIdent)) {
            aliases.push(ident.name);
          }
        }
      }
    }
  }

  for (const alias of aliases) {
    const re = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(content))) {
      const idx = match.index;
      if (!inRanges(idx, ranges)) continue;
      if (idx > 0 && content[idx - 1] === '.') continue;
      const after = skipWs(content, idx + alias.length);
      for (const name of parseChainNames(content, after)) {
        if (name.name.startsWith('$')) {
          sink.addReference(name.name, idx, name.kind, undefined, `${alias}.${name.name}`);
        }
      }
    }
  }
}

function identifiersIn(text: string): string[] {
  const out = new Set<string>();
  const re = /[A-Za-z_$][\w$]*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) out.add(match[0]);
  return [...out];
}

function templateLocalBindings(template: string): Set<string> {
  const names = new Set<string>();
  const vfor = /\bv-for\s*=\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = vfor.exec(template))) {
    const left = match[1]!.split(/\s+(?:in|of)\s+/)[0] ?? '';
    for (const id of identifiersIn(left)) names.add(id);
  }

  const slot = /(?:v-slot(?::[\w-]+)?|#[\w-]*)\s*=\s*["']([^"']+)["']/g;
  while ((match = slot.exec(template))) {
    const value = match[1]!.trim();
    if (value.startsWith('{')) {
      for (const id of identifiersIn(value)) names.add(id);
    }
  }
  return names;
}

function scanTemplateRegion(
  region: string,
  regionStart: number,
  locals: Set<string>,
  sink: ReferenceSink,
): void {
  const re = /\$[A-Za-z_][\w$]*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(region))) {
    const name = match[0];
    if (locals.has(name)) continue;
    let prev = '';
    for (let k = match.index - 1; k >= 0; k--) {
      const ch = region[k]!;
      if (!/\s/.test(ch)) {
        prev = ch;
        break;
      }
    }
    if (prev === '.') continue;
    sink.addReference(name, regionStart + match.index, 'template', undefined, name);
  }
}

function scanTemplateReferences(
  content: string,
  ranges: SourceRange[],
  sink: ReferenceSink,
): void {
  for (const range of ranges) {
    const template = content.slice(range.start, range.end);
    const locals = templateLocalBindings(template);

    const interp = /\{\{([\s\S]*?)\}\}/g;
    let match: RegExpExecArray | null;
    while ((match = interp.exec(template))) {
      scanTemplateRegion(match[1]!, range.start + match.index + 2, locals, sink);
    }

    const dir = /(?:v-[\w:-]+|[:@#][\w.:-]*)\s*=\s*(["'])([\s\S]*?)\1/g;
    while ((match = dir.exec(template))) {
      const quoteIndex = match[0].indexOf(match[1]!);
      scanTemplateRegion(match[2]!, range.start + match.index + quoteIndex + 1, locals, sink);
    }
  }
}

function scanUsageFile(content: string, rel: string, sink: ReferenceSink): void {
  if (VUE_EXT.test(rel)) {
    const scripts = scriptRanges(content);
    const templates = templateRanges(content);
    scanScriptReferences(content, scripts, rel, sink);
    scanTemplateReferences(content, templates, sink);
  } else {
    scanScriptReferences(content, [{ start: 0, end: content.length }], rel, sink);
  }
}

/* ------------------------------------------------------------------ */
/* Project / layer discovery                                          */
/* ------------------------------------------------------------------ */

async function readConfigStringArray(root: string, key: string): Promise<string[]> {
  const configPath = findConfigFile(root);
  if (!configPath) return [];
  const source = await fs.readFile(configPath, 'utf8').catch(() => '');
  if (!source) return [];
  const body = extractConfigBody(source);
  if (!body) return [];
  const raw = findTopLevelValue(body, key);
  if (raw === undefined) return [];
  const parsed = parseJsLiteral(raw);
  if (Array.isArray(parsed.value)) {
    return parsed.value.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

interface ConfigPluginEntry {
  src: string;
  mode?: string;
}

async function readConfigPlugins(root: string): Promise<Array<ConfigPluginEntry | { raw: string }>> {
  const configPath = findConfigFile(root);
  if (!configPath) return [];
  const source = await fs.readFile(configPath, 'utf8').catch(() => '');
  if (!source) return [];
  const body = extractConfigBody(source);
  if (!body) return [];
  const raw = findTopLevelValue(body, 'plugins');
  if (raw === undefined) return [];
  const parsed = parseJsLiteral(raw);
  if (!Array.isArray(parsed.value)) return [];

  const entries: Array<ConfigPluginEntry | { raw: string }> = [];
  for (const entry of parsed.value) {
    if (typeof entry === 'string') {
      entries.push({ src: entry });
      continue;
    }
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      const src = record['src'];
      const mode = record['mode'];
      if (typeof src === 'string') {
        entries.push({ src, mode: typeof mode === 'string' ? mode : undefined });
        continue;
      }
      if ('__raw' in record) {
        entries.push({ raw: String(record['__raw']) });
      }
    }
  }
  return entries;
}

async function resolvePluginSpec(root: string, srcDir: string, spec: string): Promise<string | null> {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  let abs: string;
  if (trimmed.startsWith('~~') || trimmed.startsWith('@@')) {
    abs = path.resolve(root, trimmed.slice(2).replace(/^\/+/, ''));
  } else if (trimmed.startsWith('~') || trimmed.startsWith('@')) {
    abs = path.resolve(srcDir, trimmed.slice(1).replace(/^\/+/, ''));
  } else if (path.isAbsolute(trimmed)) {
    abs = trimmed;
  } else {
    abs = path.resolve(root, trimmed);
  }
  return (await exists(abs)) ? abs : null;
}

async function resolveProjectLayers(root: string): Promise<LayerInfo[]> {
  const extendsEntries = await readConfigStringArray(root, 'extends');
  return resolveLayers(root, extendsEntries);
}

async function collectPluginTargets(
  root: string,
  layers: LayerInfo[],
  limitations: string[],
): Promise<PluginTarget[]> {
  const seen = new Set<string>();
  const targets: PluginTarget[] = [];

  for (const layer of layers) {
    const dirs = await resolveSourceDirs(layer.cwd);
    if (await exists(dirs.pluginsDir)) {
      const files = await findFiles(
        dirs.pluginsDir,
        ['**/*.{ts,js,mts,mjs}'],
        ['**/*.d.ts', '**/*.d.mts', '**/*.d.cts'],
      );
      for (const file of files) {
        if (seen.has(file)) continue;
        seen.add(file);
        targets.push({ abs: file, rel: relativePath(root, file), layer: layer.name });
      }
    }

    const configured = await readConfigPlugins(layer.cwd);
    for (const entry of configured) {
      if ('raw' in entry) {
        limitations.push(
          `Unresolved plugins entry in ${relativePath(root, layer.cwd) || '.'}: ${entry.raw}.`,
        );
        continue;
      }
      const abs = await resolvePluginSpec(layer.cwd, dirs.srcDir, entry.src);
      if (!abs) {
        limitations.push(
          `Configured plugin "${entry.src}" in ${relativePath(root, layer.cwd) || '.'} could not be resolved.`,
        );
        continue;
      }
      if (seen.has(abs)) continue;
      seen.add(abs);
      targets.push({
        abs,
        rel: relativePath(root, abs),
        layer: layer.name,
        mode: entry.mode,
      });
    }
  }

  return targets;
}

async function collectUsageFiles(
  root: string,
  layers: LayerInfo[],
): Promise<{ files: string[]; dirs: string[] }> {
  const seenFiles = new Set<string>();
  const seenDirs = new Set<string>();
  const files: string[] = [];
  const dirs: string[] = [];

  for (const layer of layers) {
    const sourceDirs = await resolveSourceDirs(layer.cwd);
    const app = path.join(layer.cwd, 'app');
    const entries: Array<{ dir: string; vue: boolean }> = [
      { dir: sourceDirs.pagesDir, vue: true },
      { dir: sourceDirs.componentsDir, vue: true },
      { dir: sourceDirs.composablesDir, vue: false },
      { dir: sourceDirs.utilsDir, vue: false },
      { dir: sourceDirs.layoutsDir, vue: true },
      { dir: sourceDirs.pluginsDir, vue: false },
      { dir: sourceDirs.middlewareDir, vue: false },
      { dir: path.join(app, 'pages'), vue: true },
      { dir: path.join(app, 'components'), vue: true },
      { dir: path.join(app, 'composables'), vue: false },
      { dir: path.join(app, 'utils'), vue: false },
      { dir: path.join(app, 'layouts'), vue: true },
      { dir: path.join(app, 'plugins'), vue: false },
      { dir: path.join(app, 'middleware'), vue: false },
    ];

    for (const { dir, vue } of entries) {
      const resolved = path.resolve(dir);
      if (seenDirs.has(resolved)) continue;
      seenDirs.add(resolved);
      if (!(await exists(resolved))) continue;
      dirs.push(relativePath(root, resolved));
      const patterns = vue ? ['**/*.vue'] : ['**/*.{ts,js,mts,mjs}'];
      for (const file of await findFiles(resolved, patterns, ['**/*.d.ts', '**/*.d.mts', '**/*.d.cts'])) {
        if (seenFiles.has(file)) continue;
        seenFiles.add(file);
        files.push(file);
      }
    }

    for (const base of [sourceDirs.srcDir, layer.cwd]) {
      for (const name of ['app.vue', 'error.vue']) {
        const abs = path.join(base, name);
        if (await exists(abs)) {
          if (!seenFiles.has(abs)) {
            seenFiles.add(abs);
            files.push(abs);
          }
        }
      }
    }
  }

  return { files, dirs: dirs.sort() };
}

async function projectName(root: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(root, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { name?: string };
    return pkg.name ?? path.basename(root);
  } catch {
    return path.basename(root);
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                        */
/* ------------------------------------------------------------------ */

function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export async function explainInjections(
  root: string,
  injectionFilter?: string,
): Promise<ExplainInjectionsResult> {
  const absRoot = path.resolve(root);
  const limitations: string[] = [];
  const skipped: string[] = [];
  const unreadable: string[] = [];
  const providers: InjectionProvider[] = [];
  const references: InjectionReference[] = [];

  const layers = await resolveProjectLayers(absRoot);
  const sourceDirs = await resolveSourceDirs(absRoot);
  const nuxtVersion = await getNuxtVersion(absRoot);
  const name = await projectName(absRoot);

  const pluginTargets = await collectPluginTargets(absRoot, layers, limitations);

  const providerSink: ProviderSink = { providers, limitations };
  for (const target of pluginTargets) {
    const content = await fs.readFile(target.abs, 'utf8').catch(() => null);
    if (content === null) {
      unreadable.push(target.rel);
      continue;
    }
    scanPluginFile(content, target, providerSink);
  }

  const { files: usageFiles, dirs: scannedDirs } = await collectUsageFiles(absRoot, layers);

  for (const abs of usageFiles) {
    const rel = relativePath(absRoot, abs);
    const content = await fs.readFile(abs, 'utf8').catch(() => null);
    if (content === null) {
      unreadable.push(rel);
      continue;
    }
    const sink: ReferenceSink = {
      addReference: (injectionName, absIndex, kind, alias, expression) => {
        const lc = lineCol(content, absIndex);
        references.push({
          injectionName: normalizeInjectionName(injectionName),
          file: rel,
          line: lc.line,
          column: lc.column,
          kind,
          alias,
          expression,
        });
      },
    };
    scanUsageFile(content, rel, sink);
  }

  const dedupedProviders = dedupe(
    providers,
    (p) => `${p.injectionName}|${p.file}|${p.line}|${p.column}|${p.form}|${p.key}`,
  ).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);

  const dedupedReferences = dedupe(
    references,
    (r) => `${r.injectionName}|${r.file}|${r.line}|${r.column}|${r.kind}`,
  ).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);

  const filterNorm = injectionFilter ? normalizeInjectionName(injectionFilter) : undefined;
  const names = new Set<string>([
    ...dedupedProviders.map((p) => p.injectionName),
    ...dedupedReferences.map((r) => r.injectionName),
  ]);
  if (filterNorm) names.add(filterNorm);

  const injections: InjectionEntry[] = [];
  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    if (filterNorm && name !== filterNorm) continue;
    const nameProviders = dedupedProviders
      .filter((p) => p.injectionName === name)
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
    const nameReferences = dedupedReferences
      .filter((r) => r.injectionName === name)
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);

    let status: InjectionStatus;
    if (nameProviders.length === 0 && FRAMEWORK_INJECTIONS.has(name)) {
      status = 'framework-provided';
    } else if (nameProviders.length === 0) {
      status = 'unresolved';
    } else if (nameProviders.length > 1) {
      status = 'multiple-providers';
    } else if (nameReferences.length === 0) {
      status = 'no-static-references';
    } else {
      status = 'resolved';
    }

    const diagnostics: InjectionDiagnostic[] = [];
    if (status === 'framework-provided') {
      diagnostics.push({
        severity: 'info',
        message:
          nameReferences.length > 0
            ? 'Provided by the Nuxt framework (or its router); not a missing user provider.'
            : 'Provided by the Nuxt framework (or its router); no static references found in the scanned scope.',
      });
    } else if (status === 'unresolved') {
      diagnostics.push({
        severity: 'info',
        message:
          'No provider found in the scanned project scope. It may be provided by a third-party module, a Nuxt built-in, runtime registration, or an inaccessible layer.',
      });
    } else if (status === 'multiple-providers') {
      diagnostics.push({
        severity: 'info',
        message:
          'More than one provider candidate found. This is not an unconditional conflict; client-only and server-only providers may intentionally share a name.',
      });
      const scopes = new Set(nameProviders.map((p) => p.scope));
      if (scopes.has('client') && scopes.has('server') && !scopes.has('universal')) {
        diagnostics.push({
          severity: 'warning',
          message:
            'Potential client/server scope overlap; may be an intentional .client/.server pair. Requires review.',
        });
      }
    }

    injections.push({
      name,
      status,
      providers: nameProviders,
      references: nameReferences,
      diagnostics,
    });
  }

  limitations.push(
    'Static source analysis only; provider detection does not execute plugin code and a detected provider is evidence that registration exists in source, not proof that it always runs.',
    'Lexical shadowing of the plugin context parameter and of script-level aliases is not fully tracked.',
    'Template-local shadowing is limited to v-for and slot-scope bindings.',
  );

  return {
    project: {
      root: absRoot,
      name,
      nuxtVersion,
      srcDir: relativePath(absRoot, sourceDirs.srcDir) || '.',
    },
    scope: {
      layers: layers.map((layer) => layer.name),
      scannedDirs,
    },
    counts: {
      providers: dedupedProviders.length,
      references: dedupedReferences.length,
      injections: injections.length,
      filesScanned: usageFiles.length,
      skipped: skipped.length,
      unreadable: unreadable.length,
    },
    injections,
    diagnostics: [],
    limitations,
    skipped,
    unreadable,
  };
}
