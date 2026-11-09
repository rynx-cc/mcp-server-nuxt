# mcp-server-nuxt v0.2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the working v0.1.0 MCP server into a production-ready Nuxt MCP server with layer resolution, auto-import registries, safe write tools, diagnostics, docs lookup, and a full `nuxt://` resource surface.

**Architecture:** Keep the existing `NuxtProjectContext` + `registerXxxTools` pattern. Add layer resolution and auto-import parsing as new read-only utils feeding both tools and resources; add a `WriteGuard` shared by all mutating tools for dry-run + authorization; add a `tsc-checker` for diagnostics; move resource registration into `src/resources/`.

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`), `@modelcontextprotocol/sdk` 1.x, `zod`, `fast-glob`, `@nuxt/kit` (optional, dynamic-imported), `vitest`.

**Spec:** provided inline in the current session (the "v0.2.0 mcp-server-nuxt" spec message: tools, resources, layers, auto-imports, safety, publishing).

## Global Constraints

- Node `>=18.0.0`; ESM only (`"type": "module"`).
- `@nuxt/kit` stays an `optionalDependency`; all its uses are dynamic imports guarded by try/catch with a source-level fallback.
- Write tools default `dryRun: true` and require `allowWrites` (env `MCP_NUXT_ALLOW_WRITES=1` or CLI `--allow-writes`) to touch disk.
- stdout carries only MCP JSON-RPC; all logging goes to stderr.
- Version bumps to `0.2.0` in `package.json` and the `McpServer` info.
- `npm run typecheck`, `npm run build`, `npm test` must all pass before commit.

## Review Focus

- **Layer priority order:** a project extending `[a, b]` must resolve local project > b > a. Tested in Task 1.
- **Missing `.nuxt/imports.d.ts`:** `get_auto_imports` and `nuxt://project/auto-imports` must return `{ built: false, imports: [] }`, not throw. Tested in Task 3.
- **Write tools without authorization:** every write tool must refuse real writes when `allowWrites` is false and explain how to enable it, while still returning the dry-run plan. Tested in Task 6.
- **Route path ↔ file mapping:** `:id`, `:id?`, `[...slug]`, and nested `index` must round-trip correctly in `add_route`. Tested in Task 7.
- **Config edits preserve comments/formatting:** `update_config` and `add_nuxt_module` must not reformat unrelated lines; diff must be minimal. Tested in Tasks 8–9.

---

### File Structure

New:
- `src/utils/layers.ts` — resolve Nuxt `extends` hierarchy into an ordered `LayerInfo` tree.
- `src/utils/auto-imports.ts` — parse `.nuxt/imports.d.ts` into an `AutoImportInfo[]` registry.
- `src/utils/tsc-checker.ts` — run `tsc --noEmit` against `.nuxt/tsconfig.json` and parse diagnostics.
- `src/utils/write-guard.ts` — `WriteGuard` for dry-run + authorization.
- `src/data/nuxt-docs.ts` — curated offline Nuxt docs snippets (routing, nitro, modules, layers, composables, config, components).
- `src/tools/layers.ts`, `src/tools/diagnostics.ts` — new tool registrars.
- `src/resources/index.ts`, `src/resources/project-structure.ts`, `src/resources/route-map.ts`, `src/resources/nuxt-config.ts`, `src/resources/module-graph.ts`, `src/resources/layers-graph.ts`, `src/resources/auto-imports.ts` — resource registrars.
- `README.md`.

Modified:
- `src/types.ts` — add `LayerInfo`, `AutoImportInfo`, `TscDiagnostic`; extend `ProjectOverview` with `layers`; add `layer?: string` to `ComponentInfo`/`ComposableInfo`/`RouteInfo`.
- `src/context.ts` — add `layers()`, `autoImports()`, `writeGuard`; `snapshot()` includes layers and layer-aware file lists.
- `src/server.ts` — wire `WriteGuard`, `registerAllResources`, version `0.2.0`.
- `src/index.ts` — parse `--allow-writes` and `MCP_NUXT_ALLOW_WRITES`.
- `src/utils/nuxt-parser.ts` — layer-aware listing; `analyzeBundleDeps()`; `routePathToFile()`/`fileToRoutePath()` helpers.
- `src/utils/config-reader.ts` — `appendModule()`.
- `src/tools/{routes,components,modules,config,server-api,composables,search}.ts` — add new tools + `inspect_*` renames.
- `package.json` — version `0.2.0`.
- `tests/` — per-task tests.

---

### Task 1: Layer resolution core

**Files:**
- Create: `src/utils/layers.ts`
- Modify: `src/types.ts` (add `LayerInfo`)
- Test: `tests/layers.test.ts`

**Interfaces:**
- Produces: `resolveLayers(root: string, extendsEntries: string[]): Promise<LayerInfo[]>`, `type LayerInfo = { cwd: string; name: string; configFile: string | null; extends: string[]; priority: number; children: LayerInfo[] }`.

- [ ] **Step 1: Write failing test** — fixture with `extends: ['../layer-a', '../layer-b']`; assert result length 3, `[0].cwd` is the project root, `[1]` is `layer-b`, `[2]` is `layer-a` (priority: project first, then later `extends` first).

- [ ] **Step 2: Run test** — `npx vitest run tests/layers.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `resolveLayers` in `src/utils/layers.ts`** — recursively resolve each `extends` entry (path relative to the layer's `nuxt.config` dir), find each layer's config with `findConfigFile`, name from its `package.json` `name` else dir basename, flatten pre-order with `priority` starting at 0.

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Commit** — `feat: add Nuxt layer resolution`.

---

### Task 2: `inspect_layers` tool + `nuxt://project/layers` resource

**Files:**
- Create: `src/tools/layers.ts`, `src/resources/layers-graph.ts`
- Modify: `src/context.ts` (add cached `layers()`), `src/tools/index.ts`

**Interfaces:**
- Consumes: `resolveLayers` from Task 1; `NuxtProjectContext.config()`.
- Produces: `registerLayerTools(server, ctx)`, `registerLayersResource(server, ctx)`.

- [ ] **Step 1: Write failing test** — `registerLayerTools` registers a tool named `inspect_layers`; handler returns JSON with `count` and `layers` whose first item is the project root. Use a real `McpServer` and inspect `server._registeredTools` names (or call the handler).

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement** — `ctx.layers()` reads `extends` from `ctx.config().value` (default `[]`), calls `resolveLayers`; `inspect_layers` tool (no args) returns `{ count, layers }`; resource `nuxt://project/layers` (application/json) returns the tree.

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Commit** — `feat: add inspect_layers tool and layers resource`.

---

### Task 3: Auto-imports registry parser

**Files:**
- Create: `src/utils/auto-imports.ts`
- Modify: `src/types.ts` (add `AutoImportInfo`)
- Test: `tests/auto-imports.test.ts`

**Interfaces:**
- Produces: `readAutoImports(root: string): Promise<{ built: boolean; imports: AutoImportInfo[] }>`, `type AutoImportInfo = { name: string; source: string; kind: 'function' | 'component' | 'value' | 'unknown'; signature?: string }`.

- [ ] **Step 1: Write failing test** — write a sample `.nuxt/imports.d.ts` with `export { ref, computed } from 'vue'` and `export { useFoo } from '/abs/composables/useFoo'`; assert parsed names/sources/kinds; assert missing `.nuxt` returns `{ built: false, imports: [] }`.

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement `readAutoImports`** — read `.nuxt/imports.d.ts` (fallback `.nuxt/types/imports.d.ts`), parse `export {...} from '...'` and `export { default as X }` lines, classify kind by source (`components/`, `.vue`, `vue` core, etc.).

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Commit** — `feat: parse .nuxt auto-imports registry`.

---

### Task 4: `get_auto_imports` tool + `nuxt://project/auto-imports` and `nuxt://project/types` resources

**Files:**
- Create: `src/resources/auto-imports.ts`
- Modify: `src/tools/composables.ts`, `src/tools/index.ts`

**Interfaces:**
- Consumes: `readAutoImports` from Task 3; `ctx.typeInfo()`.
- Produces: `get_auto_imports` tool; `registerAutoImportsResource(server, ctx)` registering `nuxt://project/auto-imports` (parsed registry) and `nuxt://project/types` (raw `typeInfo()`).

- [ ] **Step 1: Write failing test** — handler returns `imports` array matching a fixture `.nuxt/imports.d.ts`.

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement** — add `get_auto_imports` (params `{ filter?: string }`) to `registerComposableTools`; add resource registrar.

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Commit** — `feat: expose auto-imports tool and resources`.

---

### Task 5: Layer-aware component/composable/route listing

**Files:**
- Modify: `src/utils/nuxt-parser.ts`, `src/context.ts`, `src/types.ts`
- Test: `tests/layer-parsing.test.ts`

**Interfaces:**
- Produces: `listComponents(root: string, layerRoots?: string[])`, `listComposables(root, layerRoots?)`, `listPageRoutes(root, layerRoots?)`; each result item gains `layer?: string` (the layer `name`).

- [ ] **Step 1: Write failing test** — fixture with a layer dir containing `components/LayerButton.vue`; `listComponents(root, [layerRoot])` returns both local and layer component, layer one tagged with `layer`.

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement** — thread optional `layerRoots` through the three listers; skip duplicate paths; tag `layer` from the corresponding root.

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Commit** — `feat: layer-aware component, composable, and route listing`.

---

### Task 6: Write safety (`WriteGuard`) + server wiring

**Files:**
- Create: `src/utils/write-guard.ts`
- Modify: `src/server.ts`, `src/index.ts`, `src/context.ts`
- Test: `tests/write-guard.test.ts`

**Interfaces:**
- Produces: `class WriteGuard { constructor(allowWrites: boolean); authorize(dryRun: boolean): { ok: true } | { ok: false; error: string } }`. `setupServer(server, projectPath, options?: { allowWrites?: boolean })`.

- [ ] **Step 1: Write failing test** — `new WriteGuard(false).authorize(false)` returns `{ ok: false }` with a message containing `MCP_NUXT_ALLOW_WRITES`; `authorize(true)` returns `{ ok: true }`; `new WriteGuard(true).authorize(false)` returns `{ ok: true }`.

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement** — `WriteGuard`; `index.ts` parses `--allow-writes` / `MCP_NUXT_ALLOW_WRITES` into `allowWrites` and passes to `setupServer`.

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Commit** — `feat: add write authorization guard`.

---

### Task 7: `add_route`, `scaffold_nitro_api`, `generate_component`

**Files:**
- Modify: `src/tools/routes.ts`, `src/tools/server-api.ts`, `src/tools/components.ts`, `src/utils/nuxt-parser.ts`
- Test: `tests/generators.test.ts`

**Interfaces:**
- Consumes: `WriteGuard` (Task 6). Produces in nuxt-parser: `routePathToFile(routePath: string): string` (inverse of `fileToRoutePath`, `:id`→`[id]`, `:id?`→`[[id]]`, `:slug(.*)*`→`[...slug]`, trailing→`index.vue`), and `routePathToNitroFile(path, method)`.

- [ ] **Step 1: Write failing test** — assert `routePathToFile('/users/:id') === 'pages/users/[id].vue'`, `routePathToFile('/') === 'pages/index.vue'`, `routePathToFile('/docs/[...slug]') === 'pages/docs/[...slug].vue'`; and each generator tool's dry-run handler returns `{ written: false, path, content }` with expected template text.

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement** — `routePathToFile`/`routePathToNitroFile`; `add_route({ path, layout?, middleware? })`, `scaffold_nitro_api({ path, method?, zod? })`, `generate_component({ name, props?, emits?, slots? })` — all `{ dryRun }` default true, guarded via `WriteGuard.authorize`.

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Commit** — `feat: add route, nitro api, and component generators`.

---

### Task 8: `add_nuxt_module` + config `appendModule`

**Files:**
- Modify: `src/tools/modules.ts`, `src/utils/config-reader.ts`
- Test: `tests/config-reader.test.ts` (extend)

**Interfaces:**
- Produces in config-reader: `appendModule(source: string, name: string, options?: unknown): { newSource: string; diff: string }`.

- [ ] **Step 1: Write failing test** — appending a string module inserts it into the `modules` array preserving surrounding formatting; appending with options adds a `['name', {...}]` tuple.

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement** — `appendModule` locates `modules` via `findTopLevelAssignment`, injects before the array's closing `]`; `add_nuxt_module({ name, options?, dryRun })` guarded by `WriteGuard`.

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Commit** — `feat: add add_nuxt_module tool`.

---

### Task 9: `update_config` dry-run + guard retrofit

**Files:**
- Modify: `src/tools/config.ts`
- Test: `tests/config-reader.test.ts` (extend)

- [ ] **Step 1: Write failing test** — `update_config` with `dryRun: true` (or omitted) does not write the file and returns `{ ok: true, written: false, diff }`; with `dryRun: false` and `allowWrites=false` returns `{ ok: false }`.

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement** — add `{ dryRun }` param (default true); call `guard.authorize(dryRun)` before `fs.writeFile`.

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Commit** — `feat: dry-run and guard update_config`.

---

### Task 10: `tsc-checker` + `check_type_errors`

**Files:**
- Create: `src/utils/tsc-checker.ts`, `src/tools/diagnostics.ts`
- Modify: `src/types.ts` (add `TscDiagnostic`), `src/tools/index.ts`
- Test: `tests/tsc-checker.test.ts`

**Interfaces:**
- Produces: `runTscCheck(root: string): Promise<{ ran: boolean; diagnostics: TscDiagnostic[]; command?: string }>`, `type TscDiagnostic = { file?: string; line?: number; column?: number; code: number; message: string; severity: 'error' | 'warning' }`; `registerDiagnosticTools(server, ctx)`.

- [ ] **Step 1: Write failing test** — `parseTscOutput(sampleOutput)` returns structured diagnostics for a sample `file.ts(3,5): error TS2304: Cannot find name 'foo'.`; a missing `.nuxt/tsconfig.json` returns `{ ran: false }`.

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement** — export `parseTscOutput`; `runTscCheck` spawns `node_modules/.bin/tsc --noEmit -p .nuxt/tsconfig.json` (fallback `-p tsconfig.json`), parses stdout; `check_type_errors` tool returns summary + diagnostics.

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Commit** — `feat: add check_type_errors diagnostics`.

---

### Task 11: `analyze_bundle_deps`

**Files:**
- Modify: `src/utils/nuxt-parser.ts`, `src/tools/diagnostics.ts`
- Test: `tests/diagnostics.test.ts`

**Interfaces:**
- Produces: `analyzeBundleDeps(root: string): Promise<{ packages: Array<{ name: string; version?: string; kind: 'nuxt-module' | 'runtime' | 'dev' | 'unknown' }>; warnings: string[] }>`.

- [ ] **Step 1: Write failing test** — fixture `package.json` with a `@nuxt/` module in devDeps and a plain runtime dep; assert kinds and no throw when `node_modules` missing.

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement** — read `package.json` deps, classify via the existing `isNuxtModule` predicate and dep type, emit warnings for Nuxt modules present only in `dependencies` (should be dev) or missing from `node_modules`.

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Commit** — `feat: add analyze_bundle_deps tool`.

---

### Task 12: `get_nuxt_docs`

**Files:**
- Create: `src/data/nuxt-docs.ts`
- Modify: `src/tools/search.ts`
- Test: `tests/docs.test.ts`

**Interfaces:**
- Produces: `getNuxtDocs(topic: string): { topic: string; title: string; body: string; related: string[] } | null`; `get_nuxt_docs` tool (param `topic`).

- [ ] **Step 1: Write failing test** — `getNuxtDocs('routing')` returns non-null with title/body; unknown topic returns `null` and the tool returns a list of available topics.

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement** — curated static entries for `routing`, `nitro`, `modules`, `layers`, `composables`, `config`, `components`; register `get_nuxt_docs` in `registerSearchTools`.

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Commit** — `feat: add offline get_nuxt_docs tool`.

---

### Task 13: Resource registrar refactor + remaining resources

**Files:**
- Create: `src/resources/index.ts`, `src/resources/project-structure.ts`, `src/resources/route-map.ts`, `src/resources/nuxt-config.ts`, `src/resources/module-graph.ts`
- Modify: `src/tools/project-overview.ts` (move resource out), `src/server.ts`
- Test: `tests/resources.test.ts`

**Interfaces:**
- Produces: `registerAllResources(server, ctx)` registering `nuxt://project/overview`, `nuxt://project/routes`, `nuxt://project/config`, `nuxt://project/modules`, plus layers/auto-imports from Tasks 2/4.

- [ ] **Step 1: Write failing test** — a real `McpServer` with `registerAllResources` exposes all six resource URIs; `resources/read` on `nuxt://project/routes` returns JSON containing a route path.

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement** — move overview resource; add route-map, config, module-graph resources; register everything in `server.ts`.

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Commit** — `feat: consolidate nuxt:// resources`.

---

### Task 14: Renames, version bump, README, final gate

**Files:**
- Modify: `src/tools/components.ts` (`get_component`→`inspect_component`), `src/tools/pages.ts` (`analyze_page`→`inspect_route_meta`), `package.json`, `src/server.ts`, `README.md`
- Test: `npm run typecheck && npm run build && npm test`

- [ ] **Step 1: Rename tools to spec names** — `inspect_component`, `inspect_route_meta` (keep behavior; update descriptions).

- [ ] **Step 2: Bump version** — `package.json` and `McpServer` info to `0.2.0`.

- [ ] **Step 3: Write README.md** — install, MCP client config example, tool/resource tables, write-authorization env var, development commands.

- [ ] **Step 4: Run full gate** — `npm run typecheck && npm run build && npm test` all green.

- [ ] **Step 5: Commit** — `chore: v0.2.0 renames, README, and release gate`.
