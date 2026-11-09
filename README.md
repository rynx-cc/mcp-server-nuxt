# mcp-server-nuxt

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server for Nuxt projects. It exposes Nuxt internals — routes, components, composables, modules, configuration, layer (`extends`) hierarchies, and auto-import registries — as structured tools and resources so AI agents (Claude, Cursor, v0) can work with Nuxt apps with native framework awareness.

## Features

- **Framework-aware inspection** — routes, components, composables, Nitro server routes, modules, and resolved config.
- **Layer awareness** — resolves the full `extends` hierarchy with override priority order, and scans components/pages/composables across layers.
- **Zero-context hallucination prevention** — exposes the `.nuxt/imports.d.ts` auto-imports registry so agents don't guess import paths or signatures.
- **Safe writes** — all mutating tools default to `dryRun` and require explicit write authorization.
- **Diagnostics** — programmatic `tsc` type checks and dependency analysis.

## Install

```bash
npm install
npm run build
```

## Usage

Run it against a Nuxt project (defaults to the current directory):

```bash
node dist/index.js /path/to/your/nuxt/project
```

To allow write tools to actually modify files, enable authorization:

```bash
# either a CLI flag
node dist/index.js /path/to/project --allow-writes
# or an environment variable
MCP_NUXT_ALLOW_WRITES=1 node dist/index.js /path/to/project
```

### MCP client config

```json
{
  "mcpServers": {
    "mcp-server-nuxt": {
      "command": "node",
      "args": ["/path/to/mcp-server-nuxt/dist/index.js", "/path/to/your/nuxt/project"],
      "env": { "MCP_NUXT_ALLOW_WRITES": "1" }
    }
  }
}
```

## Tools

| Tool | Description |
| --- | --- |
| `get_project_overview` | Project summary: Nuxt version, layers, module/route/component counts, directories |
| `read_config` / `update_config` | Read the resolved config (dot-notation keys) / update it with a diff (dry-run by default) |
| `list_modules` / `add_nuxt_module` | List active/inactive modules / add a module to `nuxt.config` |
| `inspect_layers` | Resolve the `extends` hierarchy with override priority |
| `list_routes` / `get_route` / `add_route` | List page routes / inspect one / scaffold a new page |
| `inspect_route_meta` | Route meta: `definePageMeta`, layout, middleware, props/emits/slots |
| `list_server_routes` / `scaffold_nitro_api` | List Nitro endpoints / generate an H3 handler with optional Zod validation |
| `list_components` / `inspect_component` / `generate_component` | List components / inspect props-slots-emits / scaffold an SFC |
| `list_composables` / `get_auto_imports` | List composables / read the auto-imports registry from `.nuxt/imports.d.ts` |
| `check_type_errors` / `analyze_bundle_deps` | Run `tsc` against `.nuxt/tsconfig.json` / classify Nuxt modules vs deps |
| `search_code` / `get_nuxt_docs` | Codebase search / offline Nuxt guidance |

## Resources

| URI | Content |
| --- | --- |
| `nuxt://project/overview` | Project summary tree |
| `nuxt://project/routes` | Full resolved route map |
| `nuxt://project/config` | Resolved configuration object |
| `nuxt://project/modules` | Installed modules and configuration |
| `nuxt://project/layers` | Extends hierarchy with override priority |
| `nuxt://project/auto-imports` | Parsed auto-imports registry with source paths and signatures |
| `nuxt://project/types` | Raw generated type info (`.nuxt/imports.d.ts`, `.nuxt/types`, schema) |

## Write safety

Write tools (`update_config`, `add_route`, `add_nuxt_module`, `scaffold_nitro_api`, `generate_component`) accept a `dryRun` flag that defaults to `true`. When `dryRun` is true (or omitted) they return the planned file/diff without touching disk. Real writes require the server to be started with `MCP_NUXT_ALLOW_WRITES=1` or `--allow-writes`.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # tsup
npm run dev         # tsx src/index.ts
```

## Notes

- `@nuxt/kit` is an optional dependency. When present, `read_config` and `nuxt://project/config` use fully resolved config values; otherwise a source-level parser provides top-level keys.
- `get_auto_imports` / `nuxt://project/auto-imports` require the project to have been prepared/built (`nuxi prepare` or `nuxi build`) so `.nuxt/imports.d.ts` exists.
