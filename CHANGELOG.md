# Changelog

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
