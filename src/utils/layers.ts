/**
 * Nuxt layer (extends) resolution.
 *
 * Resolves the `extends` array from a project's resolved config into a flat,
 * priority-ordered list of layers. Priority 0 is the local project (highest
 * priority); each subsequently listed `extends` entry and its own sub-layers
 * follow in decreasing priority order. Each layer exposes a `children` tree
 * for rendering the hierarchy.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { LayerInfo } from '../types.js';
import { findConfigFile, parseConfigSource } from './config-reader.js';

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
    if (Array.isArray(ext)) return ext.filter((e): e is string => typeof e === 'string');
  } catch {
    /* keep empty */
  }
  return [];
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

  for (const entry of extendsEntries.slice().reverse()) {
    const child = await resolveLayer(path.resolve(abs, entry), counter, seen);
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

  for (const entry of extendsEntries.slice().reverse()) {
    const child = await resolveLayer(path.resolve(absRoot, entry), counter, seen);
    if (child) {
      rootLayer.children.push(child);
      appendTree(child);
    }
  }

  return result;
}
