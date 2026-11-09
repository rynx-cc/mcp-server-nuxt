# mcp-server-nuxt

<div align="center">

A production-grade Model Context Protocol server that shows LLMs how Nuxt actually works.

[![npm version](https://img.shields.io/npm/v/mcp-server-nuxt?style=flat-square&color=00DC82&label=npm)](https://www.npmjs.com/package/mcp-server-nuxt)
[![license](https://img.shields.io/npm/l/mcp-server-nuxt?style=flat-square&color=gray)](./LICENSE)
[![node](https://img.shields.io/node/v/mcp-server-nuxt?style=flat-square&color=blue)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](#)

File-based routing, auto-imports, `extends` layers, Nitro. These are the parts of Nuxt that generic LLMs get wrong most often.

</div>

---

## Why an MCP server for Nuxt?

A generic AI agent looking at a Nuxt repo sees a directory tree. It does not see:

- `pages/users/[id].vue` maps to `/users/:id`, or the `definePageMeta` middleware and layout contract.
- `components/base/BaseButton.vue` is available as `<BaseButton>` with no import statement.
- `composables/useFoo.ts` exports `useFoo()`, typed and callable anywhere.
- `extends: ['../ui-kit']` layers an override chain of components, pages, and config over the app.
- `server/api/hello.get.ts` registers `GET /api/hello` in the Nitro runtime.

Without that context the model guesses. It invents import paths, misnames auto-imported components, and misreads layer precedence. The black box is the gap between the source tree and Nuxt's resolved runtime state.

`mcp-server-nuxt` exposes that resolved state through 22 tools and 7 read-only resources over MCP. It reads Nuxt's own output rather than scanning files.

### Design principles

| Principle | What it means in code |
| --- | --- |
| Deep Nuxt Kit integration | `loadNuxtConfig()` and `.nuxt/` build outputs first, with a source-level parser as fallback |
| Layer-aware | Resolves the `extends` graph and tags each route, component, and composable with its origin layer |
| Auto-imports registry | Serves the auto-imports index with source paths and TypeScript signatures from `.nuxt/imports.d.ts` |
| Safety-first writes | Mutation tools default to `dry-run` and require `--allow-writes` |
| Strict TypeScript | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` |

---

## Quick start

Prerequisites: Node.js 18 or newer.

```bash
# via npx
npx mcp-server-nuxt@latest /path/to/your/nuxt/app

# or install globally
npm install -g mcp-server-nuxt
mcp-server-nuxt /path/to/your/nuxt/app
```

The server speaks MCP over `stdio`; it is not a web service. To run from a local checkout:

```bash
git clone https://github.com/<your-org>/mcp-server-nuxt.git
cd mcp-server-nuxt
npm install
npm run build
node dist/index.js /path/to/your/nuxt/app
```

Omit the path to use the current directory. Pass `--allow-writes` or set `MCP_NUXT_ALLOW_WRITES=1` to enable write tools. See [Write protection](#write-protection).

---

## Client configuration

### Cursor (`.cursor/mcp.json`)

```jsonc
{
  "mcpServers": {
    "mcp-server-nuxt": {
      "command": "npx",
      "args": ["mcp-server-nuxt@latest", "/path/to/your/nuxt/app"],
      "env": {
        // set this only if the agent may write files
        "MCP_NUXT_ALLOW_WRITES": "1"
      }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

```jsonc
{
  "mcpServers": {
    "mcp-server-nuxt": {
      "command": "npx",
      "args": ["mcp-server-nuxt@latest", "/path/to/your/nuxt/app"],
      "env": {
        "MCP_NUXT_ALLOW_WRITES": "1"
      }
    }
  }
}
```

Start without `MCP_NUXT_ALLOW_WRITES`. The agent can still plan every change and show you the diff before applying.

---

## Core architecture and resources

The server exposes read-only resources (`resources/*`) for large, cacheable datasets, and tools (`tools/call`) for targeted queries and mutations. Resources carry the bulk context so the agent does not re-scan files each turn.

```
                      ┌─────────────────────────────────────────┐
                      │           mcp-server-nuxt               │
                      │                                         │
  MCP client ───────► │  ┌──────────────┐   ┌───────────────┐   │
  (Claude/Cursor/v0)  │  │  22 Tools    │   │  7 Resources  │   │
                      │  └──────┬───────┘   └───────┬───────┘   │
                      │         │                   │           │
                      │         ▼                   ▼           │
                      │  NuxtProjectContext (cached snapshot)   │
                      └─────────┬───────────────────┬───────────┘
                                │                   │
                    @nuxt/kit loadNuxtConfig    .nuxt/imports.d.ts
                    extends resolution         .nuxt/tsconfig.json
```

### Resources

| URI | Content |
| --- | --- |
| `nuxt://project/overview` | Project summary: Nuxt version, layers, directories, and route/component/composable/module counts |
| `nuxt://project/routes` | Resolved route map: files, params, middleware, layouts, children |
| `nuxt://project/config` | Resolved `nuxt.config` object via `loadNuxtConfig`, with a source-level fallback |
| `nuxt://project/modules` | Installed modules with status, source, and configuration |
| `nuxt://project/layers` | `extends` hierarchy with override priority order and per-layer config |
| `nuxt://project/auto-imports` | Parsed registry of auto-imported symbols with source paths and TypeScript signatures |
| `nuxt://project/types` | Raw generated types (`.nuxt/imports.d.ts`, `.nuxt/types`, schema) |

### Layers and auto-imports

`nuxt://project/layers` resolves the `extends` graph and orders it by precedence (`project > later extends > earlier extends`), so the agent knows which `BaseButton.vue` wins when several layers define one.

`nuxt://project/auto-imports` reads `.nuxt/imports.d.ts` and returns the registry of auto-imported symbols (`ref`, `useFoo`, `BaseButton`) with their file origins and type signatures. The model does not have to guess an import path.

`nuxt://project/auto-imports` needs the app to have been prepared or built (`nuxi prepare` or `nuxi build`) so `.nuxt/imports.d.ts` exists.

---

## Tools reference

### Project and core

| Tool | Description |
| --- | --- |
| `get_project_overview` | Summary: Nuxt version, layers, module/route/component counts, directories |
| `read_config` | Read the resolved `nuxt.config`, with dot-notation key filtering |
| `update_config` | Update a config value, keep comments and formatting, return a diff |
| `list_modules` | Active and inactive Nuxt modules with version, source, and config |
| `add_nuxt_module` | Add a module to the `modules` array, with optional options |
| `inspect_layers` | Resolve and return the full `extends` hierarchy |

### Routing and architecture

| Tool | Description |
| --- | --- |
| `list_routes` | File-based, dynamic, optional, catch-all, and nested routes |
| `get_route` | One route by path, e.g. `/users/:id` |
| `add_route` | Scaffold a page under `pages/` following Nuxt conventions |
| `inspect_route_meta` | `definePageMeta`, layout, middleware, and props/emits/slots for a page |
| `list_server_routes` | Nitro endpoints, middleware, and plugins with method and middleware chain |
| `scaffold_nitro_api` | Generate an H3 handler with optional Zod body validation |

### Components, composables, and auto-imports

| Tool | Description |
| --- | --- |
| `list_components` | All components, including those injected by layers and modules |
| `inspect_component` | Props types, emits, slots, and `<script setup>` details |
| `generate_component` | Generate a typed Vue SFC |
| `list_composables` | User-defined and auto-imported composables |
| `get_auto_imports` | The `.nuxt/imports.d.ts` registry with source paths and signatures |
| `get_type_info` | Raw generated type info (`.nuxt/types`, schema) |

### Quality and diagnostics

| Tool | Description |
| --- | --- |
| `check_type_errors` | Run `tsc --noEmit` against `.nuxt/tsconfig.json` |
| `analyze_bundle_deps` | Classify Nuxt modules vs runtime/dev deps, flag missing or misplaced ones |
| `search_code` | Search the codebase with line numbers and context lines |
| `get_nuxt_docs` | Offline Nuxt guidance for routing, nitro, modules, layers |

---

## Write protection

`update_config`, `add_route`, `add_nuxt_module`, `scaffold_nitro_api`, and `generate_component` all follow the same contract:

1. `dryRun` is `true` by default. The tool returns the planned file or a diff without writing to disk.
2. A real write needs `dryRun: false` and a server started with writes enabled:

```bash
# CLI flag
mcp-server-nuxt /path/to/app --allow-writes

# or environment variable
MCP_NUXT_ALLOW_WRITES=1 mcp-server-nuxt /path/to/app
```

```jsonc
// in the client config
"env": { "MCP_NUXT_ALLOW_WRITES": "1" }
```

3. Config edits touch only the affected lines. Comments and unrelated keys stay, and every change returns a diff you can review.

Dry-run first, check the diff, then enable writes.

---

## Contributing

Pull requests are welcome.

```bash
git clone https://github.com/<your-org>/mcp-server-nuxt.git
cd mcp-server-nuxt
npm install
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest
npm run build       # tsup
```

- Follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`).
- Add tests for new tools and resources under `tests/`.
- Keep `@nuxt/kit` an optional dependency; each integration needs a fallback.
- Write tools default to `dry-run` and go through `WriteGuard`.

## License

[MIT](./LICENSE) © 2026 mcp-server-nuxt contributors.
