/**
 * Central project context: resolves the project root and provides cached
 * access to parsed project data. Shared by tools and resources.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { detectProjectRoot, loadNuxtConfig, type LoadedNuxtConfig } from './utils/config-reader.js';
import {
  getNuxtVersion,
  isBuilt,
  listComponents,
  listComposables,
  listDirectories,
  listModules,
  listPageRoutes,
  listServerRoutes,
  readTypeInfo,
} from './utils/nuxt-parser.js';
import type {
  AutoImportInfo,
  ComposableInfo,
  ComponentInfo,
  LayerInfo,
  ModuleInfo,
  ProjectOverview,
  RouteInfo,
  ServerRouteInfo,
} from './types.js';
import { resolveLayers } from './utils/layers.js';
import { readAutoImports } from './utils/auto-imports.js';
import { WriteGuard } from './utils/write-guard.js';
import { resolveSourceDirs, type SourceDirs } from './utils/source-dirs.js';

export interface ProjectSnapshot {
  routes: RouteInfo[];
  components: ComponentInfo[];
  composables: ComposableInfo[];
  serverRoutes: ServerRouteInfo[];
  modules: ModuleInfo[];
  overview: ProjectOverview;
}

export class NuxtProjectContext {
  readonly root: string;
  readonly writeGuard: WriteGuard;

  private configCache: LoadedNuxtConfig | null = null;
  private snapshotCache: ProjectSnapshot | null = null;
  private layersCache: LayerInfo[] | null = null;
  private sourceDirsCache: SourceDirs | null = null;

  constructor(root?: string, options: { allowWrites?: boolean } = {}) {
    this.root = path.resolve(root ?? detectProjectRoot(process.cwd()));
    this.writeGuard = new WriteGuard(options.allowWrites ?? false);
  }

  /** Resolve a path relative to the project root. */
  p(...segments: string[]): string {
    return path.join(this.root, ...segments);
  }

  async config(): Promise<LoadedNuxtConfig> {
    if (!this.configCache) this.configCache = await loadNuxtConfig(this.root);
    return this.configCache;
  }

  async snapshot(): Promise<ProjectSnapshot> {
    if (this.snapshotCache) return this.snapshotCache;

    const config = await this.config();
    const layers = await this.layers();
    const extraLayers = layers.slice(1).map((l) => ({ cwd: l.cwd, name: l.name }));

    const [routes, components, composables, serverRoutes, nuxtVersion, directories, built] =
      await Promise.all([
        listPageRoutes(this.root, extraLayers),
        listComponents(this.root, extraLayers),
        listComposables(this.root, extraLayers),
        listServerRoutes(this.root, extraLayers),
        getNuxtVersion(this.root),
        listDirectories(this.root),
        isBuilt(this.root),
      ]);

    const modules = await listModules(this.root, config.value);
    const name = await this.projectName();
    const configFile = config.configPath ? path.basename(config.configPath) : undefined;

    const overview: ProjectOverview = {
      root: this.root,
      name,
      framework: 'Nuxt',
      nuxtVersion,
      hasNuxtConfig: config.configPath !== null,
      configFile,
      counts: {
        routes: routes.length,
        components: components.length,
        composables: composables.length,
        serverRoutes: serverRoutes.filter((r) => r.kind === 'api' || r.kind === 'route').length,
        middleware: serverRoutes.filter((r) => r.kind === 'middleware').length,
        plugins: serverRoutes.filter((r) => r.kind === 'plugin').length,
        modules: modules.filter((m) => m.status === 'active').length,
      },
      directories,
      modules: modules.map((m) => m.name),
      layers: layers.map((l) => l.name),
      built,
    };

    this.snapshotCache = { routes, components, composables, serverRoutes, modules, overview };
    return this.snapshotCache;
  }

  /** Resolved srcDir / serverDir / pages directory for this project. */
  async sourceDirs(): Promise<SourceDirs> {
    if (!this.sourceDirsCache) this.sourceDirsCache = await resolveSourceDirs(this.root);
    return this.sourceDirsCache;
  }

  async invalidate(): Promise<void> {
    this.snapshotCache = null;
    this.configCache = null;
    this.layersCache = null;
    this.sourceDirsCache = null;
  }

  /** Resolve the Nuxt extends hierarchy (highest priority first). */
  async layers(): Promise<LayerInfo[]> {
    if (this.layersCache) return this.layersCache;
    const config = await this.config();
    const ext = config.value['extends'];
    const entries = Array.isArray(ext) ? ext.filter((e): e is string => typeof e === 'string') : [];
    this.layersCache = await resolveLayers(this.root, entries);
    return this.layersCache;
  }

  /** Read type info (.nuxt/imports.d.ts, .nuxt/types, schema). */
  async typeInfo(): Promise<Awaited<ReturnType<typeof readTypeInfo>>> {
    return readTypeInfo(this.root);
  }

  /** Read the parsed auto-imports registry (requires .nuxt build output). */
  async autoImports(): Promise<{ built: boolean; imports: AutoImportInfo[] }> {
    return readAutoImports(this.root);
  }

  private async projectName(): Promise<string> {
    try {
      const pkg = JSON.parse(await fs.readFile(this.p('package.json'), 'utf8')) as { name?: string };
      return pkg.name ?? path.basename(this.root);
    } catch {
      return path.basename(this.root);
    }
  }
}
