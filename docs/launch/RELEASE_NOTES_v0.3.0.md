## Highlights

Standalone MCP server for Nuxt is now at **0.3.0** on npm (`mcp-server-nuxt`). Agents get Nuxt’s resolved state — routes, layers, auto-imports, Nitro, modules, config — without a running DevServer.

- CLI: `--version` / `-V`, `--help` / `-h`, `--project` / `-p`
- Fixture coverage for Nuxt 3, Nuxt 4 `app/`, layers, unprepared projects, and monorepo subpackages
- Pagination (`limit` / `offset`) on large list tools
- Spec matrix: [`docs/SPEC_MATRIX.md`](./docs/SPEC_MATRIX.md)

## New / restored tools

- `generate_composable` — scaffold a typed `useXxx` under `composables/`
- `analyze_project` — health analysis with dependency warnings and prepare hints

**24 tools / 7 resources** total (core MVP: 15 / 5).

## Write safety

- Mutation tools default to **dry-run** (`dryRun: true`)
- Real writes require `--allow-writes` or `MCP_NUXT_ALLOW_WRITES=1`
- Writes outside the project root are refused
- Tool errors return `{ error: { code, message, hint } }` (no stack leakage)
- `update_config` / `add_nuxt_module` insert a trailing comma before new top-level keys (avoids invalid `nuxt.config`)

## Known issues

- `@nuxt/kit` `loadNuxtConfig` only runs when the target project has a local `nuxt` install (avoids hangs on bare fixtures); otherwise source-level parsing is used
- Auto-imports / some type tools are richer after `nuxi prepare` (when `.nuxt/` exists); other tools still work from source scan
- File watcher is disabled under Vitest so the process can exit cleanly

## Install

```bash
npx -y mcp-server-nuxt@0.3.0 /absolute/path/to/your/nuxt/app
```

Full changelog: [CHANGELOG.md](./CHANGELOG.md)
