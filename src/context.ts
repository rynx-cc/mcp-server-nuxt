/**
 * Central project context: resolves the project root and provides cached
 * access to parsed project data. Shared by tools and resources.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { detectProjectRoot, loadNuxtConfig, type LoadedNuxtConfig } from './utils/config-reader.js';
import { scanComponents } from './utils/component-scan.js';
import {
  getNuxtVersion,
  isBuilt,
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
import {
  clearTypesGeneratorState,
  ensureNuxtTypes,
  type TypesArtifacts,
} from './utils/types-generator.js';

export interface ProjectSnapshot {
  routes: RouteInfo[];
  components: ComponentInfo[];
  composables: ComposableInfo[];
  serverRoutes: ServerRouteInfo[];
  modules: ModuleInfo[];
  overview: ProjectOverview;
  /** Unresolved component dirs or `.nuxt/components.d.ts` entries. */
  componentWarnings: string[];
}

export class NuxtProjectContext {
  readonly root: string;
  readonly writeGuard: WriteGuard;

  private configCache: LoadedNuxtConfig | null = null;
  private snapshotCache: ProjectSnapshot | null = null;
  private layersCache: LayerInfo[] | null = null;
  private sourceDirsCache: SourceDirs | null = null;
  private typesCache: TypesArtifacts | null = null;

  constructor(root?: string, options: { allowWrites?: boolean } = {}) {
    this.root = path.resolve(root ?? detectProjectRoot(process.cwd()));
    this.writeGuard = new WriteGuard(options.allowWrites ?? false, this.root);
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

    const [routes, componentScan, composables, serverRoutes, nuxtVersion, directories, built] =
      await Promise.all([
        listPageRoutes(this.root, extraLayers),
        scanComponents(this.root, extraLayers),
        listComposables(this.root, extraLayers),
        listServerRoutes(this.root, extraLayers),
        getNuxtVersion(this.root),
        listDirectories(this.root),
        isBuilt(this.root),
      ]);
    const components = componentScan.components;

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

    this.snapshotCache = {
      routes,
      components,
      composables,
      serverRoutes,
      modules,
      overview,
      componentWarnings: componentScan.warnings,
    };
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
    this.typesCache = null;
    clearTypesGeneratorState(this.root);
  }

  /**
   * Ensure Nuxt type artifacts exist (project `.nuxt` or an external cache).
   * Generates via @nuxt/kit loadNuxt → buildNuxt → writeTypes when missing.
   */
  async ensureTypes(options: { force?: boolean } = {}): Promise<TypesArtifacts> {
    if (!options.force && this.typesCache?.typesDir) return this.typesCache;
    const artifacts = await ensureNuxtTypes(this.root, {
      allowWrites: this.writeGuard.allowWrites,
      force: options.force,
    });
    this.typesCache = artifacts;
    return artifacts;
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

  /** Read type info from project `.nuxt` or an auto-generated cache. */
  async typeInfo(): Promise<{
    importsDts?: string;
    typesDir?: string[];
    schema?: string;
    typesRoot?: string | null;
    source?: TypesArtifacts['source'];
    generatedMs?: number;
    error?: string;
    hint?: string;
    fallbackSummary?: { components: number; composables: number; routes: number };
  }> {
    const artifacts = await this.ensureTypes();
    if (!artifacts.typesDir) {
      const snap = await this.snapshot();
      return {
        source: 'none',
        typesRoot: null,
        error: artifacts.error,
        hint:
          artifacts.hint ??
          'No generated Nuxt types available. Install nuxt locally so mcp-server-nuxt can run loadNuxt → buildNuxt → writeTypes into a cache, or run `nuxi prepare` once. Project source scan still works for routes/components/composables.',
        fallbackSummary: {
          components: snap.components.length,
          composables: snap.composables.length,
          routes: snap.routes.length,
        },
      };
    }
    const info = await readTypeInfo(artifacts.typesDir, { projectRoot: this.root });
    return {
      ...info,
      source: artifacts.source,
      generatedMs: artifacts.generatedMs,
    };
  }

  /** Read the parsed auto-imports registry (auto-generates types when needed). */
  async autoImports(): Promise<{
    built: boolean;
    imports: AutoImportInfo[];
    source?: TypesArtifacts['source'];
    generatedMs?: number;
    hint?: string;
    error?: string;
  }> {
    const artifacts = await this.ensureTypes();
    if (!artifacts.typesDir) {
      const { buildFallbackAutoImports } = await import('./utils/fallback-imports.js');
      const snap = await this.snapshot();
      const imports = buildFallbackAutoImports(snap.components, snap.composables);
      return {
        built: true,
        imports,
        source: 'fallback',
        error: artifacts.error,
        hint:
          'No local nuxt types cache. Returning a fallback registry from scanned components/composables plus common Nuxt builtins. Install nuxt for full generated imports.d.ts.',
      };
    }
    const result = await readAutoImports(artifacts.typesDir);
    return {
      ...result,
      source: artifacts.source,
      generatedMs: artifacts.generatedMs,
    };
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
