/**
 * Static SSR-safety checks.
 *
 * Flags browser-only globals used at setup top level / module scope, values
 * that make SSR output non-deterministic (Date.now / Math.random / ...), and
 * module-scope `ref`/`reactive` state in composables (shared across requests).
 * Heuristic and line-based, matching the other static tools in this project.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exists, findFiles, relativePath } from './nuxt-parser.js';
import { resolveSourceDirs, type SourceDirs } from './source-dirs.js';

export interface SsrFinding {
  file: string;
  line: number;
  ruleId: 'browser-global-ssr' | 'nondeterministic-ssr' | 'shared-state';
  severity: 'error' | 'warning';
  reason: string;
  fix: string;
}

export interface SsrSafetyResult {
  findings: SsrFinding[];
  summary: { total: number; error: number; warning: number; filesScanned: number };
  notes: string[];
}

export interface LineRange {
  start: number;
  end: number;
}

const BROWSER_GLOBAL_RE = /\b(?:window|document|localStorage|sessionStorage|navigator|location)\b/;
const RANDOM_TIME_RE = /\b(?:Date\.now\s*\(|new\s+Date\s*\(|Math\.random\s*\(|crypto\.randomUUID\s*\(|randomUUID\s*\()/;
const SHARED_STATE_RE =
  /^\s*(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*(?:ref|reactive)\s*(?:<[^>]*>\s*)?\(/;
const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);
const HOOK_RE = /\b(?:onMounted|onBeforeMount)\b/g;
const COMPUTED_RE = /\bcomputed\s*\(/g;

function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === '\n') line++;
  return line;
}

export function isInRanges(line: number, ranges: LineRange[]): boolean {
  return ranges.some((range) => line >= range.start && line <= range.end);
}

function findOpenParen(src: string, from: number): number {
  let i = from;
  while (i < src.length && /\s/.test(src[i]!)) i++;
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

export function mountedRanges(content: string): LineRange[] {
  const ranges: LineRange[] = [];
  HOOK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HOOK_RE.exec(content))) {
    const open = findOpenParen(content, match.index + match[0].length);
    if (open === -1) continue;
    const close = findMatchingParen(content, open);
    if (close === -1) continue;
    ranges.push({ start: lineOf(content, open), end: lineOf(content, close) });
  }
  return ranges;
}

function clientGuardRanges(content: string): LineRange[] {
  const lines = content.split('\n');
  const ranges: LineRange[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/\b(?:import\.meta\.client|process\.client|typeof\s+window\b)/.test(line)) continue;
    const start = i + 1;
    let braceDepth = 0;
    let foundOpen = false;
    let end = start;
    for (let j = i; j < lines.length; j++) {
      const current = lines[j]!;
      for (const ch of current) {
        if (ch === '{') {
          braceDepth++;
          foundOpen = true;
        } else if (ch === '}') {
          braceDepth--;
        }
      }
      if (foundOpen && braceDepth <= 0) {
        end = j + 1;
        break;
      }
    }
    ranges.push({ start, end });
  }
  return ranges;
}

function clientOnlyRanges(content: string): LineRange[] {
  const ranges: LineRange[] = [];
  const re = /<ClientOnly\b[^>]*>[\s\S]*?<\/ClientOnly\s*>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    ranges.push({
      start: lineOf(content, match.index),
      end: lineOf(content, match.index + match[0].length),
    });
  }
  return ranges;
}

export function scriptRanges(content: string): LineRange[] {
  const ranges: LineRange[] = [];
  const re = /<script\b[^>]*>[\s\S]*?<\/script\s*>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    ranges.push({ start: lineOf(content, match.index), end: lineOf(content, match.index + match[0].length) });
  }
  return ranges;
}

function templateRanges(content: string): LineRange[] {
  const ranges: LineRange[] = [];
  // Nested `<template v-if>` blocks must not end the outer template range.
  const re = /<template\b[^>]*>|<\/template\s*>/g;
  let match: RegExpExecArray | null;
  let depth = 0;
  let start = -1;
  while ((match = re.exec(content))) {
    if (match[0].startsWith('</')) {
      depth--;
      if (depth <= 0 && start >= 0) {
        ranges.push({ start: lineOf(content, start), end: lineOf(content, match.index + match[0].length) });
        start = -1;
        depth = 0;
      }
    } else {
      if (depth === 0) start = match.index;
      depth++;
    }
  }
  if (start >= 0) {
    ranges.push({ start: lineOf(content, start), end: lineOf(content, content.length) });
  }
  return ranges;
}

function previousSignificant(content: string, from: number): number {
  let i = from;
  while (i >= 0 && /\s/.test(content[i]!)) i--;
  return i;
}

function matchingOpenParenBackward(content: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    const ch = content[i]!;
    if (ch === ')') depth++;
    else if (ch === '(') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * True when the `{` at `braceIndex` opens a function / method / arrow body
 * (as opposed to an object literal, an `if` block, a class body, ...).
 */
function isFunctionBrace(content: string, braceIndex: number): boolean {
  const prev = previousSignificant(content, braceIndex - 1);
  if (prev < 0) return false;
  const ch = content[prev]!;
  if (ch === '>') return true;
  if (ch !== ')') return false;
  const open = matchingOpenParenBackward(content, prev);
  if (open < 0) return true;
  const before = previousSignificant(content, open - 1);
  if (before < 0) return true;
  const word = /([A-Za-z_$][\w$]*)\s*$/.exec(content.slice(Math.max(0, before - 40), before + 1));
  if (!word) return true;
  return !CONTROL_KEYWORDS.has(word[1]!);
}

/**
 * Function nesting depth at the start of every line. Object literals and
 * control blocks do not increase it, so `depth === 0` means "runs during
 * setup / at module scope" even inside `if` or an object literal.
 */
export function functionDepthByLine(content: string): number[] {
  const lineCount = content.split('\n').length;
  const depths = Array.from({ length: lineCount }).fill(0) as number[];
  let line = 0;
  let depth = 0;
  const stack: boolean[] = [];
  let quote: string | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    if (ch === '\n') {
      lineComment = false;
      line++;
      if (line < lineCount) depths[line] = depth;
      continue;
    }
    if (lineComment) continue;
    if (blockComment) {
      if (ch === '*' && content[i + 1] === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && content[i + 1] === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && content[i + 1] === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      const isFn = isFunctionBrace(content, i);
      stack.push(isFn);
      if (isFn) depth++;
    } else if (ch === '}') {
      if (stack.pop()) depth = Math.max(0, depth - 1);
    }
  }
  return depths;
}

function computedRanges(content: string): LineRange[] {
  const ranges: LineRange[] = [];
  COMPUTED_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COMPUTED_RE.exec(content))) {
    const open = findOpenParen(content, match.index + match[0].length);
    if (open === -1) continue;
    const close = findMatchingParen(content, open);
    if (close === -1) continue;
    ranges.push({ start: lineOf(content, open), end: lineOf(content, close) });
  }
  return ranges;
}

function isClientOnlyFile(file: string): boolean {
  return /\.client\.(?:vue|ts|js|mts|mjs)$/.test(file);
}

function isComposableFile(rel: string): boolean {
  const normalized = rel.replace(/\\/g, '/');
  return (
    normalized.startsWith('composables/') ||
    normalized.startsWith('utils/') ||
    normalized.startsWith('app/composables/') ||
    normalized.startsWith('app/utils/')
  );
}

function isSkippableLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === '' ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('import ') ||
    trimmed.startsWith('export type') ||
    trimmed.startsWith('type ')
  );
}

async function scanFile(root: string, absFile: string): Promise<SsrFinding[]> {
  const rel = relativePath(root, absFile);
  if (isClientOnlyFile(absFile)) return [];

  const content = await fs.readFile(absFile, 'utf8').catch(() => '');
  if (!content) return [];

  const findings: SsrFinding[] = [];
  const lines = content.split('\n');
  const isVue = absFile.endsWith('.vue');
  const mounted = mountedRanges(content);
  const guards = clientGuardRanges(content);
  const clientOnly = clientOnlyRanges(content);
  const safeRanges = [...mounted, ...guards, ...clientOnly];
  const scripts = scriptRanges(content);
  const templates = templateRanges(content);
  const computeds = computedRanges(content);
  const functionDepths = functionDepthByLine(content);

  const addFinding = (
    line: number,
    ruleId: SsrFinding['ruleId'],
    severity: SsrFinding['severity'],
    reason: string,
    fix: string,
  ): void => {
    if (findings.some((f) => f.line === line && f.ruleId === ruleId)) return;
    findings.push({ file: rel, line, ruleId, severity, reason, fix });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;
    const inScript = !isVue || isInRanges(lineNo, scripts);
    const inTemplate = isVue && isInRanges(lineNo, templates);
    const atSetupTopLevel = (functionDepths[lineNo - 1] ?? 0) === 0;
    const inComputed = isInRanges(lineNo, computeds);

    // Rule 1: browser globals at setup top level / module scope (and template expressions).
    if (
      ((inScript && atSetupTopLevel) || inTemplate || inComputed) &&
      BROWSER_GLOBAL_RE.test(line) &&
      !isSkippableLine(line) &&
      !isInRanges(lineNo, safeRanges)
    ) {
      const severity = inTemplate || atSetupTopLevel ? 'error' : 'warning';
      const globals = [...(line.match(/\b(window|document|localStorage|sessionStorage|navigator|location)\b/g) ?? [])].join(', ');
      addFinding(
        lineNo,
        'browser-global-ssr',
        severity,
        `${globals} is only available in the browser and runs during SSR (setup top level, module scope, template or computed).`,
        'Move the access into onMounted / onBeforeMount, or guard it with import.meta.client / process.client / typeof window, or wrap it in <ClientOnly>.',
      );
    }

    // Rule 2: non-deterministic values rendered in templates or computed during SSR.
    if ((inTemplate || inComputed) && RANDOM_TIME_RE.test(line) && !isSkippableLine(line)) {
      addFinding(
        lineNo,
        'nondeterministic-ssr',
        'warning',
        'Date.now() / new Date() / Math.random() / crypto.randomUUID() make SSR output non-deterministic.',
        'Compute the value on the client (onMounted) or seed it deterministically, e.g. with useState.',
      );
    }

    // Rule 3: module-scope ref/reactive in composables (shared across requests).
    if (isComposableFile(rel) && atSetupTopLevel && SHARED_STATE_RE.test(line)) {
      addFinding(
        lineNo,
        'shared-state',
        'warning',
        'A ref/reactive declared at composable module scope is shared across all requests.',
        'Use useState() to keep per-request state, or move the declaration inside a function.',
      );
    }
  }

  return findings;
}

async function collectScanFiles(root: string, dirs: SourceDirs): Promise<string[]> {
  const app = path.join(root, 'app');
  const entries: Array<{ dir: string; vue: boolean }> = [
    { dir: dirs.pagesDir, vue: true },
    { dir: dirs.componentsDir, vue: true },
    { dir: dirs.composablesDir, vue: false },
    { dir: dirs.utilsDir, vue: false },
    { dir: dirs.layoutsDir, vue: true },
    { dir: dirs.pluginsDir, vue: false },
    { dir: dirs.middlewareDir, vue: false },
    { dir: path.join(app, 'pages'), vue: true },
    { dir: path.join(app, 'components'), vue: true },
    { dir: path.join(app, 'composables'), vue: false },
    { dir: path.join(app, 'utils'), vue: false },
    { dir: path.join(app, 'layouts'), vue: true },
    { dir: path.join(app, 'plugins'), vue: false },
    { dir: path.join(app, 'middleware'), vue: false },
  ];
  const seenDirs = new Set<string>();
  const files: string[] = [];
  for (const { dir, vue } of entries) {
    const resolved = path.resolve(dir);
    if (seenDirs.has(resolved)) continue;
    seenDirs.add(resolved);
    if (!(await exists(resolved))) continue;
    const patterns = vue ? ['**/*.vue'] : ['**/*.{ts,js,mts,mjs}'];
    files.push(...(await findFiles(resolved, patterns, ['**/*.d.ts', '**/*.d.mts', '**/*.d.cts'])));
  }
  for (const base of [dirs.srcDir, root]) {
    for (const name of ['app.vue', 'error.vue']) {
      const abs = path.join(base, name);
      if (await exists(abs)) files.push(abs);
    }
  }
  return [...new Set(files)];
}

async function filesForTarget(root: string, target?: string): Promise<string[]> {
  if (!target || target.trim() === '') {
    const dirs = await resolveSourceDirs(root);
    return collectScanFiles(root, dirs);
  }
  const abs = path.resolve(root, target);
  if (await isFile(abs)) {
    return /\.(?:vue|ts|js|mts|mjs)$/.test(abs) ? [abs] : [];
  }
  if (await exists(abs)) {
    return findFiles(abs, ['**/*.{vue,ts,js,mts,mjs}'], ['**/*.d.ts', '**/*.d.mts', '**/*.d.cts']);
  }
  return [];
}

async function isFile(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function checkSsrSafety(root: string, targetPath?: string): Promise<SsrSafetyResult> {
  const files = await filesForTarget(root, targetPath);
  const findings: SsrFinding[] = [];
  for (const file of files) {
    findings.push(...(await scanFile(root, file)));
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId));

  const error = findings.filter((f) => f.severity === 'error').length;
  const warning = findings.filter((f) => f.severity === 'warning').length;
  return {
    findings,
    summary: { total: findings.length, error, warning, filesScanned: files.length },
    notes: [
      'Static heuristic analysis only. Guard and hook detection is line-based and may miss complex expressions.',
    ],
  };
}
