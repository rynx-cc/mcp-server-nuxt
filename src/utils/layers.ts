/**
 * Nuxt layer (extends) resolution.
 *
 * Resolves the `extends` array from a project's resolved config into a flat,
 * priority-ordered list of layers. Priority 0 is the local project (highest
 * priority); each subsequently listed `extends` entry and its own sub-layers
 * follow in decreasing priority order. Each layer exposes a `children` tree
 * for rendering the hierarchy. Auto-registered `layers/*` directories come
 * right after the project, Z to A.
 */
import path from 'node:path';
import { promises as fs, type Dirent } from 'node:fs';
import type { LayerInfo } from '../types.js';
import { findConfigFile, parseConfigSource, type ResolvedLayer } from './config-reader.js';

async function exists(dir: string): Promise<boolean> {
  try {
    await fs.access(dir);
    return true;
  } catch {
    return false;
  }
}

function packageNameOf(spec: string): string | null {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(spec)) return null;
  if (spec.startsWith('@')) {
    const [scope, name] = spec.split('/');
    if (!scope || !name) return null;
    return `${scope}/${name}`;
  }
  const name = spec.split('/')[0];
  return name || null;
}

/** Resolve an extends entry to a directory, or null when it does not exist. */
export async function resolveExtendEntry(fromDir: string, entry: string): Promise<string | null> {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('.') || path.isAbsolute(trimmed)) {
    const abs = path.resolve(fromDir, trimmed);
    return (await exists(abs)) ? abs : null;
  }

  const pkgName = packageNameOf(trimmed);
  if (!pkgName) return null;
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', pkgName);
    if (await exists(candidate)) {
      const rest = trimmed.slice(pkgName.length).replace(/^\/+/, '');
      const resolved = rest ? path.join(candidate, rest) : candidate;
      return (await exists(resolved)) ? resolved : null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function layerName(dir: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(dir, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { name?: string };
    if (pkg.name) return pkg.name;
  } catch {
    /* fall through to basename */
  }
  return path.basename(dir);
}

async function readExtends(configFile: string | null): Promise<string[]> {
  if (!configFile) return [];
  try {
    const source = await fs.readFile(configFile, 'utf8');
    const parsed = parseConfigSource(source);
    const ext = parsed['extends'];
    if (typeof ext === 'string') return [ext];
    if (Array.isArray(ext)) return ext.filter((e): e is string => typeof e === 'string');
  } catch {
    /* keep empty */
  }
  return [];
}

async function localLayerDirs(root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(path.join(root, 'layers'), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => `${entry.name}/`)
    .sort((a, b) => b.localeCompare(a))
    .map((name) => path.join(root, 'layers', name.slice(0, -1)))
    .filter((dir) => findConfigFile(dir) !== null);
}

interface PriorityCounter {
  value: number;
}

async function resolveLayer(dir: string, counter: PriorityCounter, seen: Set<string>): Promise<LayerInfo | null> {
  const abs = path.resolve(dir);
  if (seen.has(abs)) return null;
  seen.add(abs);

  const configFile = findConfigFile(abs);
  const extendsEntries = await readExtends(configFile);

  const layer: LayerInfo = {
    cwd: abs,
    name: await layerName(abs),
    configFile,
    extends: extendsEntries,
    priority: counter.value++,
    children: [],
  };

  for (const entry of extendsEntries) {
    const childDir = await resolveExtendEntry(abs, entry);
    if (!childDir) continue;
    const child = await resolveLayer(childDir, counter, seen);
    if (child) layer.children.push(child);
  }

  return layer;
}

/**
 * Resolve the full extends hierarchy for a project.
 *
 * @param root absolute project root
 * @param extendsEntries raw `extends` values from the project's own config
 * @returns flat list ordered from highest priority (project) to lowest
 */
export async function resolveLayers(root: string, extendsEntries: string[]): Promise<LayerInfo[]> {
  const absRoot = path.resolve(root);
  const seen = new Set<string>([absRoot]);
  const counter: PriorityCounter = { value: 1 };

  const rootLayer: LayerInfo = {
    cwd: absRoot,
    name: await layerName(absRoot),
    configFile: findConfigFile(absRoot),
    extends: extendsEntries,
    priority: 0,
    children: [],
  };

  const result: LayerInfo[] = [rootLayer];
  const appendTree = (layer: LayerInfo): void => {
    result.push(layer);
    for (const child of layer.children) appendTree(child);
  };

  for (const dir of await localLayerDirs(absRoot)) {
    const layer = await resolveLayer(dir, counter, seen);
    if (layer) appendTree(layer);
  }

  for (const entry of extendsEntries) {
    const childDir = await resolveExtendEntry(absRoot, entry);
    if (!childDir) continue;
    const child = await resolveLayer(childDir, counter, seen);
    if (child) {
      rootLayer.children.push(child);
      appendTree(child);
    }
  }

  return result;
}

export async function layersFromResolved(resolved: ResolvedLayer[]): Promise<LayerInfo[]> {
  const result: LayerInfo[] = [];
  for (const [priority, entry] of resolved.entries()) {
    const cwd = path.resolve(entry.cwd);
    const configFile = findConfigFile(cwd);
    result.push({
      cwd,
      name: await layerName(cwd),
      configFile,
      // Kit keeps `extends` only on the root layer's config.
      extends: entry.extends.length > 0 ? entry.extends : await readExtends(configFile),
      priority,
      children: [],
    });
  }

  const realDir = (dir: string) => fs.realpath(dir).catch(() => dir);
  const byCwd = new Map<string, LayerInfo>();
  for (const layer of result) byCwd.set(await realDir(layer.cwd), layer);
  for (const layer of result) {
    for (const ext of layer.extends) {
      const dir = await resolveExtendEntry(layer.cwd, ext);
      const child = dir ? byCwd.get(await realDir(dir)) : undefined;
      if (child && child.priority > layer.priority) layer.children.push(child);
    }
  }
  return result;
}
