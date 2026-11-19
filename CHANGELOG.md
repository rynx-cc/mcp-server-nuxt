# Changelog

## 0.9.1 - 2026-11-19

### Fixed
- Prefer Kit's resolved `_layers` when Nuxt is installed, so layer discovery matches the target project (thanks [onmax](https://github.com/onmax), [#19](https://github.com/rynx-cc/mcp-server-nuxt/pull/19)).
- Source-parser layer discovery and order: auto-registered `layers/*` (Z to A) sit after the project and before `extends`, matching Nuxt precedence `project > layers/* > earlier extends > later extends` (thanks [onmax](https://github.com/onmax), [#20](https://github.com/rynx-cc/mcp-server-nuxt/pull/20)).
- Same relative page under `pages/` across layers: the higher-priority layer's file wins (thanks [onmax](https://github.com/onmax), [#21](https://github.com/rynx-cc/mcp-server-nuxt/pull/21)).

### Known limitations
- When `extends` explicitly names an auto-discovered `layers/*` directory, source-parser ordering can still differ from Kit; document and track separately.
- `explain_injections` still ignores string-form `extends` (it reads config through a separate path). Module-added pages are unchanged.

## 0.9.0 - 2026-11-17

### Added
- `explain_injections` — statically trace Nuxt plugin injections. Detects providers from `defineNuxtPlugin` function and object forms (returned `provide` objects and `nuxtApp.provide` calls, including renamed plugin context parameters), records client/server/universal scope from `.client` / `.server` files and `import.meta.client` / `import.meta.server` / `process.client` / `process.server` guards, and scans destructured, aliased, member, computed-member and Vue template references. Groups by injection name with resolution status (`resolved`, `unresolved`, `multiple-providers`, `no-static-references`, `framework-provided`), diagnostics, limitations and skipped/unreadable files. Read-only static analysis; no DevServer or `nuxi prepare`. **34 tools** total.

### Docs
- README and SPEC_MATRIX list `explain_injections`.

## 0.8.0 - 2026-11-16

### Added
- `explain_data_fetching` — list every `useFetch` / `useLazyFetch` / `useAsyncData` / `useLazyAsyncData` / `$fetch` call with URL or key, method and detected options (`lazy`, `server`, `immediate`, `watch`, `pick`, `transform`, `default`). Flags duplicate keys with different fetchers, `$fetch` in `onMounted` for template-rendered data, bare `await $fetch` at setup top level, `server: false` without lazy, and lazy results rendered without `pending` / `status`. Accepts a page/component file or a URL resolved like `explain_route`. Static analysis only; no DevServer or `nuxi prepare`.
- `check_nuxt4_migration` — check a project against the official Nuxt 4 upgrade guide: current `package.json` version, `app/` directory or `future.compatibilityVersion: 4`, legacy root directories/files, singleton data-fetching key conflicts, `getCachedData` signature, default `data`/`error` values, shallow data reactivity, shared prerender keys, boolean `dedupe`, `pending` with `immediate: false`, `route.meta` dedup, Unhead v2 props/imports, parsed `error.data`, `window.__NUXT__`, removed `generate` / experimental options, and `pages:extend` meta. Reports readiness plus counts by severity. **33 tools** total.

### Docs
- README and SPEC_MATRIX list both new tools.

## 0.7.0 - 2026-11-16

### Added
- `check_ssr_safety` — statically flag SSR hazards with file, line, rule id, severity, reason and fix: browser-only globals (`window`, `document`, `localStorage`, `sessionStorage`, `navigator`, `location`) at setup top level or module scope (skipping `onMounted` / `onBeforeMount`, `import.meta.client` / `process.client` / `typeof window` guards, `<ClientOnly>` children, `*.client.vue` files and `.client.ts` plugins); `Date.now()` / `new Date()` / `Math.random()` / `crypto.randomUUID()` in templates or computed; and module-scope `ref` / `reactive` in composables with a `useState` hint. Optional `path` scopes the scan to one file or directory. **31 tools** total.
- `explain_middleware` — explain a global (`.global.`), named, or inline `definePageMeta` middleware: type, alphabetical global run order, routes it applies to, and whether it calls `navigateTo` / `abortNavigation`. Without a name it lists all middleware, inline middleware pages, and pages that reference a middleware file that does not exist. Reuses `explain_route`'s route scanning and `definePageMeta` parsing.
- `check_runtime_config` — parse `runtimeConfig` from `nuxt.config` like the route-rules tool, flatten private and `public.*` keys (including nested keys) with their default value type and `NUXT_<KEY>` / `NUXT_PUBLIC_<KEY>` env var, scan `useRuntimeConfig()` reads (direct, destructured, aliased, bracket access), and report used-but-undefined keys, defined-but-unused keys, and private keys read in client-side code. Optionally checks `.env` / `.env.example` for each env var name without ever printing a value.

### Tests
- New fixtures and coverage for every rule and exclusion above, including nested `<template>` blocks, handlers vs setup scope, guards, client-only files, module-scope composable state, nested/global middleware order, inline middleware, missing middleware references, nested runtimeConfig keys, destructuring/aliasing, and env-file checks.

## 0.6.0 - 2026-11-16

### Added
- `find_usages` — resolve a component name / file path or composable name and list every file that uses it (explicit imports, Nuxt auto-imports, nested component names, `Lazy` prefix, kebab-case templates). Omit the target to list components and composables that are never referenced. Static analysis only; no DevServer or `nuxi prepare`. **28 tools** total.

### Fixed
- `loadNuxtConfig` loads `@nuxt/kit` from the target project's `node_modules` before this server's optional Kit 3 copy, so Nuxt 3 and Nuxt 4 each use a matching Kit. `cwd` and `rootDir` are both the project root. Kit errors are logged to stderr and the source parser still runs. The optional range stays `^3.14.0`

## 0.5.2 - 2026-11-13

### Added
- `explain_render_mode` — resolve a concrete URL's Nitro render mode from nuxt.config `routeRules` / `nitro.routeRules` (ssr / spa / prerender / isr / swr / static) with cache TTL, redirect, cors, headers, proxy, matched rules, and non-evaluable-expression notes. Static analysis only; no DevServer or `nuxi prepare`.
- `find_api_callers` — resolve a server API route by handler file path or concrete URL, then list every `useFetch` / `useLazyFetch` / `$fetch` / `useAsyncData($fetch)` caller across pages, components, composables, layouts, plugins, middleware, and utils (including Nuxt 4 `app/`). Handles template-string dynamic URLs and method mismatches. Static analysis only. **27 tools** total.
- `explain_route` now also reports a `renderMode` summary (mode + cache) using the same static route-rules analysis.

### Docs
- docs: rewrite README

## 0.5.1 - 2026-11-12

### Fixed
- Missing `bin` entry in 0.5.0 (`npx` was broken). npm 11 rejects `bin` targets written as `./dist/index.js` and strips the field when packing; use the normalized `dist/index.js` form (`npm pkg fix`). The CLI entry already starts with `#!/usr/bin/env node`.

## 0.5.0 - 2026-11-12

### Added
- `explain_route` — given a concrete URL (e.g. `/users/42`), explain Nuxt resolution: matched page + params (including catch-all), nested parents, layout (including `layout: false`), ordered global/named/inline middleware, `useFetch`/`useAsyncData`/`$fetch` calls, and mapped `server/api` handlers. Static analysis only; no DevServer or `nuxi prepare`. **25 tools** total.

### Fixed
- Node 18 can load Nuxt again. Dependencies such as `unplugin` call `path.resolve(import.meta.dirname, ...)`, and `import.meta.dirname` is undefined before Node 20.11, which surfaced as `The "paths[0]" argument must be of type string` from `get_type_info`. An ESM loader rewrites those reads to `fileURLToPath(import.meta.url)` before `@nuxt/kit` is imported. The same loader supplies `styleText` and `parseEnv` fallbacks for `node:util`, which current Nuxt packages import and Node 18 does not export
- `list_components` and `inspect_component` honor custom `components` / `components.dirs` scanning (`dirs`, array entries, `prefix`, `pathPrefix: false`, `extensions`, `global`) and resolve `~`, `@`, `~~`, and `@@` from srcDir/rootDir, including layers (#12, PR #17). Names follow Nuxt's prefix and repeated-segment rules. `.nuxt/components.d.ts` is used when it lists components. Unresolved paths are skipped with a warning instead of a guessed name

## 0.4.1

### Added
- When the target project has no local `nuxt` install: `get_auto_imports` returns a `source: "fallback"` registry from scanned components/composables plus common Nuxt builtins; `get_type_info` returns a clear hint (never `{}`)
- `.github/FUNDING.yml` (`github: rynx-cc`) and `package.json` `funding` field
- README: Claude Code and Windsurf MCP client configuration examples

### Changed
- `CLI_VERSION` is read from `package.json` (no more hardcoded version string); tests assert they match
- CI: build before test so `tests/cli.test.ts` runs against `dist`; matrix includes `windows-latest`
- Docs: CHANGELOG / release notes correctly describe `list_routes` as `resolveSourceDirs` + file scan, and config via `loadNuxtConfig` (not `loadNuxt`)

### Tests
- `tests/fallback-imports.test.ts`: `no-prepare` fixture returns fallback imports / type hints without creating `.nuxt`

## 0.4.0

### Added
- Zero-setup type tools: `get_type_info`, `check_type_errors`, and `get_auto_imports` work without `nuxi prepare` and without a running DevServer
- When the target project has a local `nuxt` install, types are generated via `@nuxt/kit` (`loadNuxt` with `dev: false` → `buildNuxt` → `writeTypes` → `close`) into a cache directory (`node_modules/.cache/mcp-server-nuxt/types/...` or the system temp dir). The project stays free of a newly created `.nuxt` unless writes are enabled (`--allow-writes` / `MCP_NUXT_ALLOW_WRITES`)
- Cache is keyed by `nuxt.config` + `package.json` fingerprint and reused until either changes
- `check_type_errors` prefers the generated tsconfig and always explains when results may be incomplete
- `get_project_overview` / `analyze_project` treat missing `.nuxt` as optional, not an error

### Tests
- `tests/auto-types.test.ts`: with local nuxt, no `.nuxt` still yields type info into cache

## 0.3.0

### Added
- `generate_composable` and `analyze_project` (original MVP tools restored)
- CLI flags: `--version` / `-V`, `--help` / `-h`, `--project` / `-p`
- Fixture e2e coverage for Nuxt 3, Nuxt 4 `app/`, layers, unprepared projects, and monorepo subpackages
- Pagination (`limit` / `offset`) for `list_components`, `search_code`, and `analyze_project`
- Structured tool errors: `{ error: { code, message, hint } }` (no stack leakage)
- Write path sandbox: refuse writes outside the project root
- Spec matrix at `docs/SPEC_MATRIX.md`

### Fixed
- `list_routes` / listing resolve Nuxt pages dirs via `resolveSourceDirs` + file scan (`srcDir`, `dir.pages`, `app/pages`); config reading uses `loadNuxtConfig` when a local `nuxt` install is present, otherwise a source-level parse
- Missing `.nuxt` returns prepare / auto-generation hints instead of crashing
- `loadNuxtConfig` via kit only when the target project has a local `nuxt` install (avoids hangs on bare fixtures)
- Watcher disabled under Vitest so the process can exit
- `update_config` / `add_nuxt_module` now insert a trailing comma before appending a new top-level key (was producing invalid `nuxt.config`)

### Docs
- README: absolute paths, Claude Desktop / Cursor / VS Code samples, write-safety, architecture
- GitHub Actions CI matrix for Node 18 / 20 / 22

## 0.2.0

- Layers, auto-imports, write guard, diagnostics, docs lookup, and `nuxt://` resources
- npm publish prep (shebang, optional `@nuxt/kit`)
