# mcp-server-nuxt 0.3.0

Standalone MCP server for Nuxt — expose routes, components, layers, auto-imports, Nitro, modules, and config to AI agents **without** a running DevServer.

**Install:** `npx -y mcp-server-nuxt@0.3.0 /absolute/path/to/your/nuxt/app`

## Highlights

- CLI flags: `--version` / `-V`, `--help` / `-h`, `--project` / `-p`
- Fixture e2e coverage for Nuxt 3, Nuxt 4 `app/`, layers, unprepared projects, and monorepo subpackages
- Pagination (`limit` / `offset`) for `list_components`, `search_code`, and `analyze_project`
- Structured tool errors: `{ error: { code, message, hint } }` (no stack leakage)
- Spec matrix: [`docs/SPEC_MATRIX.md`](https://github.com/rynx-cc/mcp-server-nuxt/blob/main/docs/SPEC_MATRIX.md)
- **24 tools / 7 resources** (core MVP: 15 tools / 5 resources)

## New tools

| Tool | Description |
| --- | --- |
| `generate_composable` | Scaffold a typed `useXxx` composable under `composables/` |
| `analyze_project` | Health analysis with dependency warnings, pagination, and prepare hints |

Also restored/expanded in this release: pagination on large list tools, CLI entry polish, and write-path sandboxing.

## Write safety

- Mutation tools default to **dry-run** (`dryRun: true`)
- Real writes require `--allow-writes` **or** `MCP_NUXT_ALLOW_WRITES=1`
- Writes outside the project root are refused
- Tool errors return structured `{ error: { code, message, hint } }` — no stack leakage to the client
- `update_config` / `add_nuxt_module` insert a trailing comma before appending a new top-level key (avoids invalid `nuxt.config`)

## Fixes

- `list_routes` / listing resolve Nuxt pages dirs (`srcDir`, `dir.pages`, `app/pages`) with optional `@nuxt/kit` `loadNuxt` when available; file scan is the fallback
- Missing `.nuxt` returns prepare hints instead of crashing
- `loadNuxtConfig` via kit only when the target project has a local `nuxt` install (avoids hangs on bare fixtures)
- Watcher disabled under Vitest so the process can exit
- Config appends no longer produce invalid trailing-comma-less `nuxt.config`

## Known issues

- `@nuxt/kit` `loadNuxtConfig` only runs when the target project has a local `nuxt` install; otherwise source-level parsing is used
- Auto-imports / some type tools are richer after `nuxi prepare` (when `.nuxt/` exists); other tools still work from source scan
- File watcher is disabled under Vitest so the process can exit cleanly

## Links

- npm: https://www.npmjs.com/package/mcp-server-nuxt
- Changelog: https://github.com/rynx-cc/mcp-server-nuxt/blob/main/CHANGELOG.md
- Spec matrix: https://github.com/rynx-cc/mcp-server-nuxt/blob/main/docs/SPEC_MATRIX.md
