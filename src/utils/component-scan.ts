/**
 * Component discovery that follows Nuxt's `components` option.
 *
 * Prefer `.nuxt/components.d.ts` when it lists components. Otherwise scan
 * configured directories (array form, `dirs`, or the default `components/`
 * tree), resolving `~` / `@` to srcDir and `~~` / `@@` to rootDir. An entry
 * that cannot be resolved is skipped and warned about — never guessed.
 */
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { findConfigFile, parseConfigSource } from './config-reader.js';
import {
  componentAutoImportName,
  findFiles,
  parseVueComponent,
  relativePath,
} from './nuxt-parser.js';
import { resolveSourceDirs } from './source-dirs.js';
import type { ComponentInfo } from '../types.js';

export interface ComponentScan {
  components: ComponentInfo[];
  warnings: string[];
}

interface LayerTarget {
  cwd: string;
  name?: string;
}

interface ResolvedDir {
  path: string;
  prefix?: string;
  pathPrefix: boolean;
  extensions: string[];
  global: boolean;
  /** Missing default `components` / `global` / `islands` dirs are not warnings. */
  silentIfMissing: boolean;
}

const DEFAULT_EXTENSIONS = ['vue'];

export async function scanComponents(
  root: string,
  layers: Array<{ cwd: string; name: string }> = [],
): Promise<ComponentScan> {
  const warnings: string[] = [];
  const targets: LayerTarget[] = [
    { cwd: path.resolve(root) },
    ...layers.map((layer) => ({ cwd: path.resolve(layer.cwd), name: layer.name })),
  ];

  const fromDts = await componentsFromDeclaration(path.resolve(root), targets, warnings);
  if (fromDts) {
    return { components: fromDts, warnings };
  }

  const components: ComponentInfo[] = [];
  const seenFiles = new Set<string>();
  const seenNames = new Map<string, string>();

  for (const target of targets) {
    const dirs = await resolveComponentDirs(target.cwd, warnings);
    const scannedPrefixes: string[] = [];
    const sorted = [...dirs].sort((a, b) => pathDepth(b.path) - pathDepth(a.path));

    for (const dir of sorted) {
      if (!(await isDirectory(dir.path))) {
        if (!dir.silentIfMissing && !isDefaultComponentsPath(dir.path)) {
          pushWarning(warnings, `Skipping components directory "${dir.path}": path does not exist`);
        }
        continue;
      }

      const pattern = globPattern(dir.extensions);
      const files = await findFiles(dir.path, [pattern], ['**/*.d.ts', '**/*.d.mts', '**/*.d.cts']);
      for (const file of files) {
        const absolutePath = path.resolve(file);
        if (scannedPrefixes.some((prefix) => absolutePath.startsWith(prefix))) continue;
        if (seenFiles.has(absolutePath)) continue;
        seenFiles.add(absolutePath);

        const name = componentAutoImportName(relativePath(dir.path, absolutePath), {
          prefix: dir.prefix,
          pathPrefix: dir.pathPrefix,
        });
        if (!name) {
          pushWarning(warnings, `Skipping ${absolutePath}: resolved component name is empty`);
          continue;
        }
        const previous = seenNames.get(name);
        if (previous) {
          pushWarning(
            warnings,
            `Duplicate component name ${name} at ${absolutePath}; keeping ${previous}`,
          );
          continue;
        }
        seenNames.set(name, absolutePath);

        const meta = absolutePath.endsWith('.vue')
          ? await parseVueComponent(absolutePath)
          : { props: [], emits: [], slots: [] };
        components.push({
          name,
          file: relativePath(target.cwd, absolutePath),
          absolutePath,
          directory: directoryLabel(target.cwd, absolutePath),
          props: meta.props,
          emits: meta.emits,
          slots: meta.slots,
          autoImported: true,
          isPage: false,
          global: dir.global || undefined,
          layer: target.name,
        });
      }

      scannedPrefixes.push(path.resolve(dir.path) + path.sep);
    }
  }

  components.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
  return { components, warnings };
}

/** Component list without the scan warnings. */
export async function listComponents(
  root: string,
  layers: Array<{ cwd: string; name: string }> = [],
): Promise<ComponentInfo[]> {
  return (await scanComponents(root, layers)).components;
}

async function componentsFromDeclaration(
  root: string,
  targets: LayerTarget[],
  warnings: string[],
): Promise<ComponentInfo[] | null> {
  const dtsPath = path.join(root, '.nuxt', 'components.d.ts');
  if (!existsSync(dtsPath)) return null;

  let source: string;
  try {
    source = await fs.readFile(dtsPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pushWarning(warnings, `Could not read ${dtsPath}: ${message}`);
    return null;
  }

  const decls = parseComponentDeclarations(source).filter((decl) => !/^Lazy[A-Z]/.test(decl.name));
  if (decls.length === 0) return null;

  const components: ComponentInfo[] = [];
  const seenNames = new Set<string>();
  for (const decl of decls) {
    if (seenNames.has(decl.name)) continue;
    const absolutePath = resolveDeclarationFile(dtsPath, decl.specifier);
    if (!absolutePath) {
      pushWarning(
        warnings,
        `Skipping component ${decl.name} from .nuxt/components.d.ts: cannot resolve "${decl.specifier}"`,
      );
      continue;
    }
    seenNames.add(decl.name);
    const owner = owningTarget(absolutePath, targets);
    const meta = absolutePath.endsWith('.vue')
      ? await parseVueComponent(absolutePath)
      : { props: [], emits: [], slots: [] };
    components.push({
      name: decl.name,
      file: relativePath(owner.cwd, absolutePath),
      absolutePath,
      directory: directoryLabel(owner.cwd, absolutePath),
      props: meta.props,
      emits: meta.emits,
      slots: meta.slots,
      autoImported: true,
      isPage: false,
      layer: owner.name,
    });
  }

  components.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
  return components;
}

interface Declaration {
  name: string;
  specifier: string;
}

function parseComponentDeclarations(source: string): Declaration[] {
  const decls: Declaration[] = [];
  const re =
    /(?:export\s+const\s+|^\s*)([A-Za-z_$][\w$]*)\s*:\s*(?:[\w.]+\s*<\s*)*typeof\s+import\(\s*(['"])([^'"]+)\2\s*\)/gm;
  for (const match of source.matchAll(re)) {
    const name = match[1];
    const specifier = match[3];
    if (!name || !specifier) continue;
    decls.push({ name, specifier: specifier.split('?')[0]! });
  }
  return decls;
}

function resolveDeclarationFile(dtsPath: string, specifier: string): string | null {
  if (!specifier || specifier.startsWith('#')) return null;
  const base = path.resolve(path.dirname(dtsPath), specifier);
  const candidates = path.extname(base)
    ? [base]
    : [base, ...['.vue', '.tsx', '.jsx', '.ts', '.js', '.mjs'].map((ext) => base + ext)];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function owningTarget(file: string, targets: LayerTarget[]): LayerTarget {
  const resolved = path.resolve(file);
  let best: LayerTarget = targets[0] ?? { cwd: path.dirname(resolved) };
  let bestLen = -1;
  for (const target of targets) {
    const cwd = path.resolve(target.cwd);
    if (resolved === cwd || resolved.startsWith(cwd + path.sep)) {
      if (cwd.length > bestLen) {
        best = target;
        bestLen = cwd.length;
      }
    }
  }
  return best;
}

async function resolveComponentDirs(projectRoot: string, warnings: string[]): Promise<ResolvedDir[]> {
  const sourceDirs = await resolveSourceDirs(projectRoot);
  const option = await readComponentsOption(projectRoot, warnings);
  if (option.kind === 'disabled') return [];
  if (option.kind === 'default' || option.kind === 'unparsed') {
    return defaultDirs(sourceDirs.srcDir);
  }

  const resolved: ResolvedDir[] = [];
  for (const entry of option.entries) {
    const dir = normalizeEntry(entry, sourceDirs.srcDir, sourceDirs.root, option.global, warnings);
    if (dir) resolved.push(dir);
  }
  return resolved;
}

type ComponentsOption =
  | { kind: 'default' }
  | { kind: 'disabled' }
  | { kind: 'unparsed' }
  | { kind: 'entries'; entries: unknown[]; global?: boolean };

async function readComponentsOption(projectRoot: string, warnings: string[]): Promise<ComponentsOption> {
  const configPath = findConfigFile(projectRoot);
  if (!configPath) return { kind: 'default' };
  let source = '';
  try {
    source = await fs.readFile(configPath, 'utf8');
  } catch {
    return { kind: 'default' };
  }
  const parsed = parseConfigSource(source);
  if (!Object.prototype.hasOwnProperty.call(parsed, 'components')) return { kind: 'default' };

  const expanded = expandRaw(parsed['components'], warnings, 'components');
  if (expanded === undefined) {
    pushWarning(
      warnings,
      'Could not parse the components option; scanning the default components directory',
    );
    return { kind: 'unparsed' };
  }
  if (expanded === false || expanded === null) return { kind: 'disabled' };
  if (expanded === true) return { kind: 'default' };

  if (Array.isArray(expanded)) {
    return { kind: 'entries', entries: expanded.filter((entry) => entry !== undefined) };
  }
  if (typeof expanded === 'object') {
    const record = expanded as Record<string, unknown>;
    const global = typeof record['global'] === 'boolean' ? record['global'] : undefined;
    if (Array.isArray(record['dirs'])) {
      return {
        kind: 'entries',
        entries: record['dirs'].filter((entry) => entry !== undefined),
        global,
      };
    }
    if (typeof record['path'] === 'string') {
      return { kind: 'entries', entries: [record], global };
    }
  }

  pushWarning(warnings, 'Could not parse the components option; scanning the default components directory');
  return { kind: 'unparsed' };
}

function defaultDirs(srcDir: string): ResolvedDir[] {
  return [
    dirRecord(path.join(srcDir, 'components', 'islands'), { silentIfMissing: true }),
    dirRecord(path.join(srcDir, 'components', 'global'), { global: true, silentIfMissing: true }),
    dirRecord(path.join(srcDir, 'components'), { silentIfMissing: true }),
  ];
}

function normalizeEntry(
  entry: unknown,
  srcDir: string,
  rootDir: string,
  inheritedGlobal: boolean | undefined,
  warnings: string[],
): ResolvedDir | null {
  if (typeof entry === 'string') {
    const resolved = resolveAliasPath(entry, srcDir, rootDir);
    if (!resolved.ok) {
      pushWarning(warnings, `Skipping components entry "${entry}": ${resolved.error}`);
      return null;
    }
    return dirRecord(resolved.path, { global: inheritedGlobal, silentIfMissing: false });
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    pushWarning(warnings, 'Skipping components entry: expected a path string or an object with path');
    return null;
  }
  const record = entry as Record<string, unknown>;
  if (record['enabled'] === false) return null;
  if (typeof record['path'] !== 'string' || record['path'].trim() === '') {
    pushWarning(warnings, 'Skipping components entry: object is missing path');
    return null;
  }
  const resolved = resolveAliasPath(record['path'], srcDir, rootDir);
  if (!resolved.ok) {
    pushWarning(warnings, `Skipping components entry "${record['path']}": ${resolved.error}`);
    return null;
  }
  const prefix = typeof record['prefix'] === 'string' && record['prefix'] ? record['prefix'] : undefined;
  const pathPrefix = record['pathPrefix'] === false ? false : true;
  const extensions = normalizeExtensions(record['extensions']);
  const global = typeof record['global'] === 'boolean' ? record['global'] : Boolean(inheritedGlobal);
  return dirRecord(resolved.path, { prefix, pathPrefix, extensions, global, silentIfMissing: false });
}

function dirRecord(
  dirPath: string,
  options: {
    prefix?: string;
    pathPrefix?: boolean;
    extensions?: string[];
    global?: boolean;
    silentIfMissing?: boolean;
  } = {},
): ResolvedDir {
  return {
    path: dirPath,
    prefix: options.prefix,
    pathPrefix: options.pathPrefix !== false,
    extensions: options.extensions && options.extensions.length > 0 ? options.extensions : DEFAULT_EXTENSIONS,
    global: Boolean(options.global),
    silentIfMissing: Boolean(options.silentIfMissing),
  };
}

function normalizeExtensions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const exts = value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim().replace(/^\./, ''));
  return exts.length > 0 ? exts : undefined;
}

function resolveAliasPath(
  input: string,
  srcDir: string,
  rootDir: string,
): { ok: true; path: string } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'path is empty' };
  if (trimmed.startsWith('#')) return { ok: false, error: `alias "${trimmed}" is not resolved` };

  const normalized = trimmed.replace(/\\/g, '/');
  const aliases: Array<[string, string]> = [
    ['~~', rootDir],
    ['@@', rootDir],
    ['~', srcDir],
    ['@', srcDir],
  ];
  for (const [alias, base] of aliases) {
    if (normalized === alias) return { ok: true, path: base };
    if (normalized.startsWith(`${alias}/`)) {
      return { ok: true, path: path.resolve(base, normalized.slice(alias.length + 1)) };
    }
  }
  if (normalized.startsWith('~') || (normalized.startsWith('@') && !normalized.startsWith('@/'))) {
    return { ok: false, error: `alias "${trimmed}" is not resolved` };
  }
  if (path.isAbsolute(trimmed)) return { ok: true, path: path.resolve(trimmed) };
  return { ok: true, path: path.resolve(srcDir, trimmed) };
}

function isDefaultComponentsPath(dirPath: string): boolean {
  return /(?:^|[/\\])components(?:[/\\](?:global|islands))?$/.test(dirPath);
}

function pathDepth(dirPath: string): number {
  return dirPath.split(/[/\\]/).filter(Boolean).length;
}

function globPattern(extensions: string[]): string {
  if (extensions.length === 1) return `**/*.${extensions[0]}`;
  return `**/*.{${extensions.join(',')}}`;
}

function directoryLabel(root: string, file: string): string {
  const rel = relativePath(root, file);
  if (rel === 'components' || rel.startsWith('components/') || rel.includes('/components/')) return 'components';
  const parent = path.posix.dirname(rel);
  return parent === '.' ? 'components' : parent;
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await fs.stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

function pushWarning(warnings: string[], message: string): void {
  warnings.push(message);
  console.warn(`[mcp-server-nuxt] ${message}`);
}

function expandRaw(value: unknown, warnings: string[], label: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => expandRaw(item, warnings, `${label}[${index}]`));
  }
  if (isRaw(value)) {
    const parsed = parseJsLiteral(value.__raw);
    if (!parsed.ok) {
      pushWarning(warnings, `Could not parse ${label}`);
      return undefined;
    }
    return expandRaw(parsed.value, warnings, label);
  }
  return value;
}

function isRaw(value: unknown): value is { __raw: string } {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 1 &&
    typeof (value as { __raw?: unknown }).__raw === 'string'
  );
}

interface LiteralResult {
  ok: boolean;
  value: unknown;
}

/** Parse a JS literal (object, array, string, number, boolean, null). */
function parseJsLiteral(input: string): LiteralResult {
  const parser = new LiteralParser(input.trim());
  const value = parser.parseValue();
  parser.skip();
  if (!parser.ok || parser.remaining()) return { ok: false, value: undefined };
  return { ok: true, value };
}

class LiteralParser {
  private i = 0;
  ok = true;

  constructor(private readonly src: string) {}

  remaining(): boolean {
    return this.i < this.src.length;
  }

  parseValue(): unknown {
    this.skip();
    if (this.i >= this.src.length) {
      this.ok = false;
      return undefined;
    }
    const ch = this.src[this.i]!;
    if (ch === '{') return this.parseObject();
    if (ch === '[') return this.parseArray();
    if (ch === '"' || ch === "'") return this.parseString(ch);
    if (ch === '`') {
      this.ok = false;
      return undefined;
    }
    if (this.starts('true') && this.boundary(4)) {
      this.i += 4;
      return true;
    }
    if (this.starts('false') && this.boundary(5)) {
      this.i += 5;
      return false;
    }
    if (this.starts('null') && this.boundary(4)) {
      this.i += 4;
      return null;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) return this.parseNumber();
    this.ok = false;
    return undefined;
  }

  skip(): void {
    while (this.i < this.src.length) {
      const ch = this.src[this.i]!;
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
        this.i++;
        continue;
      }
      if (ch === '/' && this.src[this.i + 1] === '/') {
        this.i += 2;
        while (this.i < this.src.length && this.src[this.i] !== '\n') this.i++;
        continue;
      }
      if (ch === '/' && this.src[this.i + 1] === '*') {
        this.i += 2;
        while (this.i < this.src.length && !(this.src[this.i] === '*' && this.src[this.i + 1] === '/')) this.i++;
        this.i += 2;
        continue;
      }
      break;
    }
  }

  private parseObject(): Record<string, unknown> | undefined {
    this.i++;
    const obj: Record<string, unknown> = {};
    this.skip();
    if (this.src[this.i] === '}') {
      this.i++;
      return obj;
    }
    while (this.i < this.src.length) {
      const key = this.parseKey();
      if (!this.ok || key === undefined) return undefined;
      this.skip();
      if (this.src[this.i] !== ':') {
        this.ok = false;
        return undefined;
      }
      this.i++;
      const value = this.parseValue();
      if (!this.ok) return undefined;
      obj[key] = value;
      this.skip();
      if (this.src[this.i] === ',') {
        this.i++;
        this.skip();
        if (this.src[this.i] === '}') {
          this.i++;
          return obj;
        }
        continue;
      }
      if (this.src[this.i] === '}') {
        this.i++;
        return obj;
      }
      this.ok = false;
      return undefined;
    }
    this.ok = false;
    return undefined;
  }

  private parseArray(): unknown[] | undefined {
    this.i++;
    const items: unknown[] = [];
    this.skip();
    if (this.src[this.i] === ']') {
      this.i++;
      return items;
    }
    while (this.i < this.src.length) {
      const value = this.parseValue();
      if (!this.ok) return undefined;
      items.push(value);
      this.skip();
      if (this.src[this.i] === ',') {
        this.i++;
        this.skip();
        if (this.src[this.i] === ']') {
          this.i++;
          return items;
        }
        continue;
      }
      if (this.src[this.i] === ']') {
        this.i++;
        return items;
      }
      this.ok = false;
      return undefined;
    }
    this.ok = false;
    return undefined;
  }

  private parseKey(): string | undefined {
    this.skip();
    const ch = this.src[this.i];
    if (ch === '"' || ch === "'") return this.parseString(ch);
    const start = this.i;
    while (this.i < this.src.length && /[\w$]/.test(this.src[this.i]!)) this.i++;
    if (this.i === start) {
      this.ok = false;
      return undefined;
    }
    return this.src.slice(start, this.i);
  }

  private parseString(quote: string): string | undefined {
    this.i++;
    let out = '';
    while (this.i < this.src.length) {
      const ch = this.src[this.i]!;
      if (ch === '\\') {
        const next = this.src[this.i + 1];
        if (next === undefined) break;
        out += next;
        this.i += 2;
        continue;
      }
      if (ch === quote) {
        this.i++;
        return out;
      }
      out += ch;
      this.i++;
    }
    this.ok = false;
    return undefined;
  }

  private parseNumber(): number | undefined {
    const start = this.i;
    if (this.src[this.i] === '-') this.i++;
    while (this.i < this.src.length && /[0-9.]/.test(this.src[this.i]!)) this.i++;
    const raw = this.src.slice(start, this.i);
    const value = Number(raw);
    if (!raw || Number.isNaN(value)) {
      this.ok = false;
      return undefined;
    }
    return value;
  }

  private starts(word: string): boolean {
    return this.src.startsWith(word, this.i);
  }

  private boundary(length: number): boolean {
    const next = this.src[this.i + length];
    return next === undefined || !/[\w$]/.test(next);
  }
}
