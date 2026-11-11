# Spec matrix (original MVP → implementation)

Original MVP target: **15 tools** and **5 resources**. v0.2.0 shipped extras (layers, auto-imports, diagnostics, docs). This table is the contract for v0.3.0 release readiness.

## Tools (15 core)

| # | Spec name | Implementation | Test file(s) | Status |
| --- | --- | --- | --- | --- |
| 1 | `get_project_overview` | `get_project_overview` | `tests/fixture-e2e.test.ts` | OK |
| 2 | `list_routes` | `list_routes` | `tests/nuxt-parser.test.ts`, `tests/fixture-e2e.test.ts` | OK (Nuxt-aware dirs + scan fallback) |
| 3 | `get_route` | `get_route` | `tests/fixture-e2e.test.ts` | OK |
| 4 | `add_route` | `add_route` | `tests/generators.test.ts` | OK |
| 5 | `list_components` | `list_components` | `tests/layer-parsing.test.ts`, `tests/pagination.test.ts` | OK |
| 6 | `inspect_component` | `inspect_component` | `tests/fixture-e2e.test.ts` | OK |
| 7 | `generate_component` | `generate_component` | `tests/generators.test.ts` | OK |
| 8 | `list_composables` | `list_composables` | `tests/layer-parsing.test.ts` | OK |
| 9 | `generate_composable` | `generate_composable` | `tests/generators.test.ts` | Restored in 0.3.0 |
| 10 | `list_server_routes` | `list_server_routes` | `tests/fixture-e2e.test.ts` | OK |
| 11 | `scaffold_nitro_api` | `scaffold_nitro_api` | `tests/generators.test.ts` | OK |
| 12 | `list_modules` | `list_modules` | `tests/fixture-e2e.test.ts` | OK |
| 13 | `read_config` | `read_config` | `tests/config-tool.test.ts` | OK |
| 14 | `update_config` | `update_config` | `tests/config-tool.test.ts` | OK |
| 15 | `analyze_project` | `analyze_project` | `tests/generators.test.ts`, `tests/pagination.test.ts` | Restored in 0.3.0 |

## Resources (5 core)

| # | Spec URI | Implementation | Test file(s) | Status |
| --- | --- | --- | --- | --- |
| 1 | `nuxt://project/overview` | `nuxt://project/overview` | `tests/resources.test.ts` | OK |
| 2 | `nuxt://project/routes` | `nuxt://project/routes` | `tests/resources.test.ts` | OK |
| 3 | `nuxt://project/config` | `nuxt://project/config` | `tests/resources.test.ts` | OK |
| 4 | `nuxt://project/modules` | `nuxt://project/modules` | `tests/resources.test.ts` | OK |
| 5 | `nuxt://project/layers` | `nuxt://project/layers` | `tests/layers-tool.test.ts`, `tests/resources.test.ts` | OK |

## Extra surface (v0.2+, kept)

Tools: `inspect_route_meta`, `get_auto_imports`, `get_type_info`, `add_nuxt_module`, `inspect_layers`, `check_type_errors`, `analyze_bundle_deps`, `search_code`, `get_nuxt_docs`.

Resources: `nuxt://project/auto-imports`, `nuxt://project/types`.

**Total registered in 0.3.0:** 24 tools, 7 resources.
