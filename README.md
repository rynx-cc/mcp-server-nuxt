# mcp-server-nuxt

<div align="center">

**A production-grade Model Context Protocol server that teaches LLMs how Nuxt actually works.**

[![npm version](https://img.shields.io/npm/v/mcp-server-nuxt?style=flat-square&color=00DC82&label=npm)](https://www.npmjs.com/package/mcp-server-nuxt)
[![license](https://img.shields.io/npm/l/mcp-server-nuxt?style=flat-square&color=gray)](./LICENSE)
[![node](https://img.shields.io/node/v/mcp-server-nuxt?style=flat-square&color=blue)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](#)

> File-based routing, auto-imports, `extends` layers, Nitro — the "magic" that makes Nuxt delightful is exactly what makes generic LLMs hallucinate. This server hands them the ground truth.

</div>

---

## Why an MCP server for Nuxt?

A generic AI agent staring at a Nuxt repo sees a directory tree. It does **not** see:

- `pages/users/[id].vue` → `/users/:id`, nor the `definePageMeta` middleware/layout contract.
- `components/base/BaseButton.vue` → `<BaseButton>` auto-imported with **zero** import statements.
- `composables/useFoo.ts` → `useFoo()` callable everywhere, typed, with no import.
- `extends: ['../ui-kit']` → an entire override chain of components, pages, and config layered on top of your app.
- `server/api/hello.get.ts` → `GET /api/hello` wired into the Nitro runtime.

Without that context, the model guesses. It invents import paths, misnames auto-imported components, and misreads layer precedence. **The "black box" isn't Nuxt — it's the gap between the source tree and Nuxt's resolved runtime state.**

`mcp-server-nuxt` closes that gap. It speaks Nuxt natively, exposing resolved state — not raw file globs — through 22 tools and 7 read-only resources over the MCP protocol.

### Design principles

| Principle | What it means in code |
| --- | --- |
| **Deep Nuxt Kit integration** | `loadNuxtConfig()` and `.nuxt/` build outputs first; heuristic parsing only as a graceful fallback |
| **Layer-aware** | Recursively resolves the `extends` graph and tags every route/component/composable with its origin layer |
| **Zero-hallucination registry** | Serves the full auto-imports index with TypeScript signatures straight from `.nuxt/imports.d.ts` |
| **Safety-first writes** | Every mutation tool defaults to `dry-run` and requires explicit `--allow-writes` |
| **Strict TypeScript** | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` — production posture |

---

## Quick Start

**Prerequisites:** Node.js ≥ 18.

```bash
# via npx (no install)
npx mcp-server-nuxt@latest /path/to/your/nuxt/app

# or install globally
npm install -g mcp-server-nuxt
mcp-server-nuxt /path/to/your/nuxt/app
```

The server speaks MCP over `stdio` — it is not a web service. Run it from a local checkout:

```bash
git clone https://github.com/<your-org>/mcp-server-nuxt.git
cd mcp-server-nuxt
npm install
npm run build
node dist/index.js /path/to/your/nuxt/app
```

> 💡 Omit the path to use the current directory. Pass `--allow-writes` (or set `MCP_NUXT_ALLOW_WRITES=1`) to enable write tools — see [Safety First](#-safety-first-write-protection).

---

## Client Configuration

### Cursor — `.cursor/mcp.json`

```jsonc
{
  "mcpServers": {
    "mcp-server-nuxt": {
      "command": "npx",
      "args": ["mcp-server-nuxt@latest", "/path/to/your/nuxt/app"],
      "env": {
        // ⚠️ only set this if you want the agent to be able to write files
        "MCP_NUXT_ALLOW_WRITES": "1"
      }
    }
  }
}
```

### Claude Desktop — `claude_desktop_config.json`

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

> 🔒 **Security tip:** start without `MCP_NUXT_ALLOW_WRITES`. The agent can still *plan* every change (and you review the diff). Enable writes only when you're ready to let it edit.

---

## Core Architecture & Resources

The server exposes **read-only resources** (MCP `resources/*`) for large, cacheable datasets, and **tools** (MCP `tools/call`) for targeted queries and mutations. Resources carry the bulk context so the agent doesn't re-scan files on every turn.

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

### Resource index

| URI | Content |
| --- | --- |
| `nuxt://project/overview` | Project summary: Nuxt version, layer list, directory layout, route/component/composable/module counts |
| `nuxt://project/routes` | Full resolved route map — files, params, middleware, layouts, children |
| `nuxt://project/config` | Resolved `nuxt.config` object (via `loadNuxtConfig`, source-level fallback) |
| `nuxt://project/modules` | Installed modules with status, source, and configuration payload |
| `nuxt://project/layers` ⭐ | Full `extends` hierarchy with **override priority order** and per-layer config |
| `nuxt://project/auto-imports` ⭐ | Parsed registry of every auto-imported symbol + source path + TypeScript signature |
| `nuxt://project/types` | Raw generated types (`.nuxt/imports.d.ts`, `.nuxt/types`, schema) |

### The two star resources

**`nuxt://project/layers`** — Nuxt's `extends` feature distributes components, pages, composables, and config across multiple projects. This resource resolves the whole graph and orders it by precedence (`project > later extends > earlier extends`), so the agent knows *which* `BaseButton.vue` actually wins.

**`nuxt://project/auto-imports`** — reads `.nuxt/imports.d.ts` and returns the exact registry of active auto-imported symbols (`ref`, `useFoo`, `BaseButton`…) with their file origins and type signatures. The model never has to guess an import path again — **drastically fewer tokens, zero hallucinated signatures**.

> ⚙️ `nuxt://project/auto-imports` requires the app to have been prepared/built (`nuxi prepare` or `nuxi build`) so `.nuxt/imports.d.ts` exists.

---

## Tools Reference

### 🧭 Project & Core

| Tool | Description |
| --- | --- |
| `get_project_overview` | High-level summary: Nuxt version, layers, module/route/component counts, directories |
| `read_config` | Read the resolved `nuxt.config` (dot-notation key filtering) |
| `update_config` | Update a config value while preserving comments/formatting, returns a diff |
| `list_modules` | Active/inactive Nuxt modules with version, source, and config |
| `add_nuxt_module` | Append a module (with optional options) to the `modules` array |
| `inspect_layers` | Resolve and return the full `extends` hierarchy tree |

### 🧭 Routing & Architecture

| Tool | Description |
| --- | --- |
| `list_routes` | File-based, dynamic, optional, catch-all, and nested routes |
| `get_route` | Inspect a single route by path (e.g. `/users/:id`) |
| `add_route` | Scaffold a page under `pages/` following Nuxt conventions |
| `inspect_route_meta` | `definePageMeta`, layout, middleware, props/emits/slots for a page |
| `list_server_routes` | Nitro API endpoints, middleware, and plugins with method + middleware chain |
| `scaffold_nitro_api` | Generate an H3 handler with optional Zod body validation |

### 🧭 Components, Composables & "Magic"

| Tool | Description |
| --- | --- |
| `list_components` | All components incl. those injected by external layers and modules |
| `inspect_component` | Props types, emits, slots, and `<script setup>` details |
| `generate_component` | Generate a typed Vue SFC following project conventions |
| `list_composables` | User-defined and auto-imported composables |
| `get_auto_imports` | The exact `.nuxt/imports.d.ts` registry with source paths + signatures |
| `get_type_info` | Raw generated type info (`.nuxt/types`, schema) |

### 🧭 Quality & Diagnostics

| Tool | Description |
| --- | --- |
| `check_type_errors` | Programmatic `tsc --noEmit` against `.nuxt/tsconfig.json` |
| `analyze_bundle_deps` | Classify Nuxt modules vs runtime/dev deps, flag missing/misplaced ones |
| `search_code` | Fast codebase search with line numbers and context lines |
| `get_nuxt_docs` | Offline, deterministic Nuxt guidance (routing, nitro, modules, layers…) |

---

## 🔒 Safety First (Write Protection)

Every mutating tool — `update_config`, `add_route`, `add_nuxt_module`, `scaffold_nitro_api`, `generate_component` — follows the same contract:

1. **`dryRun: true` by default.** The tool returns the planned file contents or a unified diff **without touching disk**.
2. **Explicit authorization required.** A real write happens only when `dryRun` is `false` **and** the server was started with writes enabled:

```bash
# CLI flag
mcp-server-nuxt /path/to/app --allow-writes

# or environment variable
MCP_NUXT_ALLOW_WRITES=1 mcp-server-nuxt /path/to/app
```

```jsonc
// config side (Cursor / Claude Desktop)
"env": { "MCP_NUXT_ALLOW_WRITES": "1" }
```

3. **Config edits preserve formatting.** The config modifier touches only the affected lines — comments and unrelated keys stay intact, and every change returns a reviewable diff.

> 🔐 Recommend your agents to *always* dry-run first, present the diff, and only then apply with write authorization enabled.

---

## Contributing

Contributions are welcome — this is a young project and the Nuxt ecosystem is large.

```bash
git clone https://github.com/<your-org>/mcp-server-nuxt.git
cd mcp-server-nuxt
npm install
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest
npm run build       # tsup
```

Guidelines:

- Follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`).
- Add tests for new tools/resources — `vitest` fixtures under `tests/`.
- Keep `@nuxt/kit` an optional dependency; every integration must have a graceful fallback.
- Write tools default to `dry-run` and route through `WriteGuard`.

## License

[MIT](./LICENSE) © 2026 mcp-server-nuxt contributors.

---

<div align="center">

**Built for the Nuxt ecosystem — so your AI pair-programmer finally *gets* `defineNuxtConfig`, `useAsyncData`, and `extends`.**

⭐ Star it. Break it. Open issues.

</div>
