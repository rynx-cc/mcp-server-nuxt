# Changelog

## 0.4.0

### Added
- Zero-setup type tools: `get_type_info`, `check_type_errors`, and `get_auto_imports` work without `nuxi prepare` and without a running DevServer
- On first use, types are generated via `@nuxt/kit` (`loadNuxt` → `buildNuxt` → `writeTypes`) into a cache directory (`node_modules/.cache/mcp-server-nuxt/types/...` or the system temp dir), so the project stays free of a newly created `.nuxt` unless writes are enabled (`--allow-writes` / `MCP_NUXT_ALLOW_WRITES`)
- Cache is keyed by `nuxt.config` fingerprint and reused until the config changes
- `get_project_overview` / `analyze_project` hints explain auto-generation instead of only telling users to run `nuxi prepare`

### Tests
- `tests/auto-types.test.ts`: fixture without `.nuxt` still returns type info; project directory stays clean

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
- `list_routes` / listing now resolve Nuxt pages dirs (`srcDir`, `dir.pages`, `app/pages`) with optional `@nuxt/kit` `loadNuxt` when available; file scan is the fallback
- Missing `.nuxt` returns prepare hints instead of crashing
- `loadNuxtConfig` via kit only when the target project has a local `nuxt` install (avoids hangs on bare fixtures)
- Watcher disabled under Vitest so the process can exit
- `update_config` / `add_nuxt_module` now insert a trailing comma before appending a new top-level key (was producing invalid `nuxt.config`)

### Docs
- README: absolute paths, Claude Desktop / Cursor / VS Code samples, write-safety, architecture
- GitHub Actions CI matrix for Node 18 / 20 / 22

## 0.2.0

- Layers, auto-imports, write guard, diagnostics, docs lookup, and `nuxt://` resources
- npm publish prep (shebang, optional `@nuxt/kit`)
