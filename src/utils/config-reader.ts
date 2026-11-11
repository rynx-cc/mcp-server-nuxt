/**
 * Read, parse and safely modify `nuxt.config.*` files.
 *
 * Resolution strategy:
 *  1. Try `@nuxt/kit`'s `loadNuxtConfig()` for fully-resolved config values.
 *  2. Fall back to a lightweight source-level parser so the server still works
 *     when the project's dependencies are not installed or `@nuxt/kit` fails.
 */
import { promises as fs, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ConfigDiff } from '../types.js';

const CONFIG_FILENAMES = [
  'nuxt.config.ts',
  'nuxt.config.js',
  'nuxt.config.mts',
  'nuxt.config.mjs',
  'nuxt.config.cjs',
] as const;

export interface LoadedNuxtConfig {
  /** The fully-resolved config object (when available) */
  value: Record<string, unknown>;
  /** Raw source text of the config file */
  source: string | null;
  /** Absolute path of the config file, or null if none found */
  configPath: string | null;
  /** How the config was loaded */
  sourceKind: 'resolved' | 'parsed' | 'raw' | 'none';
  /** Error message when resolution failed */
  error?: string;
}

/** Locate the project root by walking up from `start` looking for nuxt.config.*. */
export function detectProjectRoot(start = process.cwd()): string {
  let current = path.resolve(start);

  // If a file was passed, use its directory.
  try {
    if (statSync(current).isFile()) return path.dirname(current);
  } catch {
    /* not a file */
  }

  for (;;) {
    if (hasConfigFile(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

/** Check whether a directory contains a nuxt.config file. */
export function findConfigFile(root: string): string | null {
  for (const name of CONFIG_FILENAMES) {
    const full = path.join(root, name);
    if (existsSync(full)) return full;
  }
  return null;
}

function hasConfigFile(root: string): boolean {
  return findConfigFile(root) !== null;
}

/**
 * Load the Nuxt config. Never throws — always returns a best-effort result.
 */
export async function loadNuxtConfig(projectRoot: string): Promise<LoadedNuxtConfig> {
  const configPath = findConfigFile(projectRoot);
  if (!configPath) {
    return {
      value: {},
      source: null,
      configPath: null,
      sourceKind: 'none',
      error: `No nuxt.config file found in ${projectRoot}`,
    };
  }

  let source: string | null = null;
  try {
    source = await fs.readFile(configPath, 'utf8');
  } catch {
    /* keep null */
  }

  // Attempt resolved config via @nuxt/kit only when the target project has Nuxt installed.
  // Calling kit against bare fixtures (no local node_modules/nuxt) can hang or be very slow.
  const projectHasNuxt = existsSync(path.join(projectRoot, 'node_modules', 'nuxt', 'package.json'));
  if (projectHasNuxt) {
    try {
      const kit = await import('@nuxt/kit');
      if (typeof kit.loadNuxtConfig === 'function') {
        const value = (await kit.loadNuxtConfig({
          rootDir: projectRoot,
          overrides: { _mcpServerNuxt: true },
        })) as Record<string, unknown>;
        return {
          value: stripInternalKeys(value),
          source,
          configPath,
          sourceKind: 'resolved',
        };
      }
    } catch {
      // Fall through to source-level parsing.
    }
  }

  // Source-level parse: extract the object literal passed to defineNuxtConfig.
  try {
    const value = parseConfigSource(source ?? '');
    return {
      value,
      source,
      configPath,
      sourceKind: value && Object.keys(value).length > 0 ? 'parsed' : 'raw',
    };
  } catch (err) {
    return {
      value: {},
      source,
      configPath,
      sourceKind: 'raw',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function stripInternalKeys(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key.startsWith('_') || key === '$schema') continue;
    out[key] = v;
  }
  return out;
}

/**
 * Extremely permissive source parser. Extracts top-level `key: value` pairs
 * from the object literal inside `defineNuxtConfig({ ... })`.
 *
 * This is intentionally heuristic: it only needs to be good enough to answer
 * `read_config` questions when `@nuxt/kit` is unavailable.
 */
export function parseConfigSource(source: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const body = extractConfigBody(source);
  if (!body) return result;

  const assignments = splitTopLevel(body);
  for (const assignment of assignments) {
    const match = assignment.match(/^[\s,;]*["']?([\w$.-]+)["']?\s*[:=]\s*([\s\S]*)$/);
    if (!match) continue;
    const key = match[1]!;
    const rawValue = match[2]!.trim().replace(/[,;]\s*$/, '');
    result[key] = tryParseValue(rawValue);
  }
  return result;
}

/** Extract the object body of `defineNuxtConfig({ ... })` (or `export default { ... }`). */
export function extractConfigBody(source: string): string | null {
  // Strip block comments and strings-agnostic approach: find the first `{`
  // after `defineNuxtConfig(` and match balanced braces.
  const defMatch = source.match(/defineNuxtConfig\s*\(\s*(\{)/);
  let startIndex = defMatch ? source.indexOf('{', defMatch.index ?? 0) : -1;

  if (startIndex === -1) {
    // Fallback: `export default { ... }`
    const expMatch = source.match(/export\s+default\s+(\{)/);
    startIndex = expMatch ? source.indexOf('{', expMatch.index ?? 0) : -1;
  }

  if (startIndex === -1) return null;

  let depth = 0;
  let inString: string | null = null;
  let inTemplate = false;
  let inComment: 'line' | 'block' | null = null;

  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i]!;
    const prev = i > 0 ? source[i - 1]! : '';

    if (inComment === 'line') {
      if (ch === '\n') inComment = null;
      continue;
    }
    if (inComment === 'block') {
      if (ch === '*' && source[i + 1] === '/') {
        inComment = null;
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

    if (ch === '/' && source[i + 1] === '/') {
      inComment = 'line';
      i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      inComment = 'block';
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

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(startIndex + 1, i);
    }
  }
  return null;
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let inString: string | null = null;
  let inTemplate = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (inString) {
      current += ch;
      if (ch === '\\') {
        current += body[i + 1] ?? '';
        i++;
      } else if (ch === inString) inString = null;
      continue;
    }
    if (inTemplate) {
      current += ch;
      if (ch === '\\') {
        current += body[i + 1] ?? '';
        i++;
      } else if (ch === '`') inTemplate = false;
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

function tryParseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* not JSON */
  }
  // Unquote simple strings
  const strMatch = trimmed.match(/^(["'])([\s\S]*)\1$/);
  if (strMatch) return strMatch[2];
  // Arrays of strings, e.g. ['a', 'b']
  const arrMatch = trimmed.match(/^\[([\s\S]*)\]$/);
  if (arrMatch && !trimmed.includes('=>')) {
    const items = splitTopLevel(arrMatch[1]!)
      .map((i) => i.trim())
      .filter(Boolean)
      .map((i) => tryParseValue(i.replace(/^,/, '').trim()));
    return items;
  }
  // Fall back to a "raw expression" marker so callers know it is unresolved JS.
  return { __raw: trimmed };
}

/**
 * Read a config value by dot-notation key, e.g. `runtimeConfig.public.apiBase`.
 */
export function getConfigValue(config: Record<string, unknown>, key?: string): unknown {
  if (!key || key === '') return config;
  const parts = key.split('.');
  let current: unknown = config;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Serialize an arbitrary value to a JS expression (for code generation). */
export function serializeValue(value: unknown, indent = 0): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'function') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const pad = ' '.repeat(indent + 2);
    const inner = value.map((v) => pad + serializeValue(v, indent + 2)).join(',\n');
    return `[\n${inner},\n${' '.repeat(indent)}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const pad = ' '.repeat(indent + 2);
    const inner = entries
      .map(([k, v]) => `${pad}${JSON.stringify(k)}: ${serializeValue(v, indent + 2)}`)
      .join(',\n');
    return `{\n${inner},\n${' '.repeat(indent)}}`;
  }
  return String(value);
}

/**
 * Modify the nuxt.config source by setting a dot-notation key.
 * Preserves comments/formatting by only touching the affected lines.
 */
export function setConfigValue(
  source: string,
  key: string,
  value: unknown,
  rawValue?: string,
): { newSource: string; diff: string } {
  const body = extractConfigBody(source);
  if (!body) throw new Error('Could not locate defineNuxtConfig({...}) in nuxt.config');

  const expression = rawValue ?? serializeValue(value);
  const parts = key.split('.');
  const topKey = parts[0]!;

  const existing = findTopLevelAssignment(body, topKey);

  let newBody: string;
  if (!existing) {
    // Insert before the closing brace.
    newBody = insertBeforeClosing(body, `${topKey}: ${expression},`);
  } else if (parts.length === 1) {
    newBody = body.replace(existing.fullMatch, `${topKey}: ${expression}`);
  } else {
    // Nested key. Only handle when the top-level value is an object literal.
    const nested = setNestedKey(existing.value, parts.slice(1), value, rawValue);
    newBody = body.replace(existing.fullMatch, `${topKey}: ${nested}`);
  }

  const newSource = replaceConfigBody(source, body, newBody);
  const diff = createDiff(source, newSource);
  return { newSource, diff };
}

/**
 * Append a module to the `modules` array in a nuxt.config source,
 * preserving surrounding keys and formatting.
 */
export function appendModule(
  source: string,
  name: string,
  options?: unknown,
): { newSource: string; diff: string } {
  const body = extractConfigBody(source);
  if (!body) throw new Error('Could not locate defineNuxtConfig({...}) in nuxt.config');

  const entry = options === undefined ? JSON.stringify(name) : `[${JSON.stringify(name)}, ${serializeValue(options)}]`;
  const existing = findTopLevelAssignment(body, 'modules');

  let newBody: string;
  if (existing) {
    const trimmed = existing.value.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const inner = trimmed.slice(1, -1).trim();
      newBody = body.replace(existing.fullMatch, `modules: [${inner ? `${inner}, ${entry}` : entry}]`);
    } else {
      // `modules` exists but is not an array literal; replace it.
      newBody = body.replace(existing.fullMatch, `modules: [${entry}]`);
    }
  } else {
    newBody = insertBeforeClosing(body, `modules: [${entry}],`);
  }

  const newSource = replaceConfigBody(source, body, newBody);
  const diff = createDiff(source, newSource);
  return { newSource, diff };
}

interface TopLevelAssignment {
  fullMatch: string;
  value: string;
}

function findTopLevelAssignment(body: string, key: string): TopLevelAssignment | null {
  const assignments = splitTopLevel(body);
  for (const assignment of assignments) {
    const match = assignment.match(/^([\s]*)(["']?)([\w$.-]+)\2\s*:\s*([\s\S]*)$/);
    if (!match) continue;
    if (match[3] === key) {
      return { fullMatch: assignment.trim(), value: match[4]!.trim() };
    }
  }
  return null;
}

function insertBeforeClosing(body: string, line: string): string {
  const indent = detectIndent(body);
  const trimmed = body.replace(/\s+$/, '');
  return `${trimmed}\n${indent}${line}\n`;
}

function detectIndent(body: string): string {
  const lines = body.split('\n');
  const lastNonEmpty = [...lines].reverse().find((l) => l.trim() !== '') ?? '';
  return lastNonEmpty.match(/^\s*/)?.[0] ?? '';
}

function setNestedKey(
  valueText: string,
  parts: string[],
  value: unknown,
  rawValue?: string,
): string {
  const expression = rawValue ?? serializeValue(value);
  const objMatch = valueText.match(/^\{([\s\S]*)\}$/);
  if (!objMatch) {
    // Can't navigate into a non-object; replace the whole top-level value.
    return `{ ${parts[0]}: ${expression} }`;
  }
  const inner = objMatch[1]!;
  const existing = findTopLevelAssignment(inner, parts[0]!);
  if (!existing) {
    return `{${inner}\n  ${parts[0]}: ${expression},\n}`;
  }
  if (parts.length === 1) {
    return `{${inner.replace(existing.fullMatch, `${parts[0]}: ${expression}`)}}`;
  }
  return `{${inner.replace(
    existing.fullMatch,
    `${parts[0]}: ${setNestedKey(existing.value, parts.slice(1), value, rawValue)}`,
  )}}`;
}

function replaceConfigBody(source: string, oldBody: string, newBody: string): string {
  const idx = source.indexOf(oldBody);
  if (idx === -1) return source;
  return source.slice(0, idx) + newBody + source.slice(idx + oldBody.length);
}

/** Minimal unified-diff-like output for a before/after pair. */
export function createDiff(before: string, after: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const lines: string[] = [];

  // Simple line diff: only emit changed runs with a small amount of context.
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  let context: Array<{ b: number; a: number; text: string }> = [];

  for (let i = 0; i < maxLen; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b === a) {
      if (context.length) {
        lines.push(...context.map((c) => `  ${c.text}`));
        context = [];
      }
      lines.push(`  ${b ?? ''}`);
    } else {
      if (context.length === 0) lines.push('---');
      if (b !== undefined) context.push({ b: i, a: -1, text: `- ${b}` });
      if (a !== undefined) context.push({ b: -1, a: i, text: `+ ${a}` });
    }
  }
  if (context.length) lines.push(...context.map((c) => `  ${c.text}`));

  return lines.join('\n') || '(no changes)';
}

/** Build a ConfigDiff from before/after state. */
export function buildConfigDiff(key: string, oldValue: unknown, newValue: unknown, diff: string): ConfigDiff {
  return { key, oldValue, newValue, diff };
}
