# Changelog

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
