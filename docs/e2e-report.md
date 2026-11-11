# mcp-server-nuxt 0.3.0 e2e report

Generated: 2026-11-11T07:48:45.977Z

- Packed binary: `/tmp/mcp-nuxt-pack-OVj6to/node_modules/.bin/mcp-server-nuxt`
- Real project: `/tmp/mcp-nuxt-real-ZlS9KT`
- Bare project: `/tmp/mcp-nuxt-bare-FKocyV`
- Rows: 46 — **46 PASS** / **0 FAIL**

## Results

| Name | Kind | Status | ms | Summary |
| --- | --- | --- | ---: | --- |
| `listTools (real)` | meta | **PASS** | 0 | 24 tools |
| `listResources (real)` | meta | **PASS** | 0 | 7 resources |
| `get_project_overview` | tool | **PASS** | 895 | {"root":"/tmp/mcp-nuxt-real-ZlS9KT","name":"mcp-nuxt-real-ZlS9KT","framework":"Nuxt","nuxtVersion":"4.6.4","hasNuxtConfi… |
| `list_routes` | tool | **PASS** | 1 | {"count":3,"total":3,"routes":[{"path":"/","file":"app/pages/index.vue","absolutePath":"/tmp/mcp-nuxt-real-ZlS9KT/app/pa… |
| `get_route` | tool | **PASS** | 0 | {"found":true,"route":{"path":"/","file":"app/pages/index.vue","absolutePath":"/tmp/mcp-nuxt-real-ZlS9KT/app/pages/index… |
| `list_components` | tool | **PASS** | 0 | {"count":1,"total":1,"limit":50,"offset":0,"truncated":false,"components":[{"name":"BaseBadge","file":"app/components/Ba… |
| `inspect_component` | tool | **PASS** | 0 | {"found":true,"component":{"name":"BaseBadge","file":"app/components/BaseBadge.vue","absolutePath":"/tmp/mcp-nuxt-real-Z… |
| `list_composables` | tool | **PASS** | 0 | {"count":1,"total":1,"autoImportedCount":1,"composables":[{"name":"useGreeting","file":"app/composables/useGreeting.ts",… |
| `list_server_routes` | tool | **PASS** | 0 | {"count":1,"totals":{"api":1,"middleware":0,"plugin":0},"routes":[{"path":"/api/hello","file":"server/api/hello.get.ts",… |
| `list_modules` | tool | **PASS** | 0 | {"count":1,"active":0,"modules":[{"name":"nuxt","version":"^4.6.4","status":"inactive","source":"package.json","local":f… |
| `read_config` | tool | **PASS** | 2 | {"configFile":"/tmp/mcp-nuxt-real-ZlS9KT/nuxt.config.ts","sourceKind":"parsed","value":{"compatibilityDate":"2025-07-15"… |
| `analyze_project` | tool | **PASS** | 1 | {"name":"mcp-nuxt-real-ZlS9KT","nuxtVersion":"4.6.4","built":true,"hasNuxtConfig":true,"counts":{"routes":3,"components"… |
| `get_auto_imports` | tool | **PASS** | 1 | {"built":true,"count":212,"total":212,"imports":[{"name":"useScriptTriggerConsent","source":"#app/composables/script-stu… |
| `get_type_info` | tool | **PASS** | 1 | {"importsDts":"export { useScriptTriggerConsent, useScriptEventPage, useScriptTriggerElement, useScript, useScriptGoogle… |
| `inspect_layers` | tool | **PASS** | 0 | {"count":1,"layers":[{"cwd":"/tmp/mcp-nuxt-real-ZlS9KT","name":"mcp-nuxt-real-ZlS9KT","configFile":"/tmp/mcp-nuxt-real-Z… |
| `search_code` | tool | **PASS** | 3 | {"query":"BaseBadge","count":1,"totalMatched":1,"limit":10,"offset":0,"truncated":false,"matches":[{"file":"app/pages/in… |
| `analyze_bundle_deps` | tool | **PASS** | 0 | {"packages":[{"name":"nuxt","version":"^4.6.4","kind":"nuxt-module"},{"name":"vue","version":"^3.5.45","kind":"runtime"}… |
| `inspect_route_meta` | tool | **PASS** | 0 | {"found":true,"route":{"path":"/","file":"app/pages/index.vue","absolutePath":"/tmp/mcp-nuxt-real-ZlS9KT/app/pages/index… |
| `check_type_errors` | tool | **PASS** | 0 | {"ran":false,"errors":0,"warnings":0,"diagnostics":[],"hint":"Typecheck skipped. Ensure `.nuxt/tsconfig.json` exists (`n… |
| `get_nuxt_docs` | tool | **PASS** | 0 | {"found":true,"topic":"routing","title":"File-based Routing","body":"Nuxt maps files under pages/ to routes. `pages/inde… |
| `nuxt://project/overview` | resource | **PASS** | 1 | {
  "root": "/tmp/mcp-nuxt-real-ZlS9KT",
  "name": "mcp-nuxt-real-ZlS9KT",
  "framework": "Nuxt",
  "nuxtVersion": "4.6.… |
| `nuxt://project/routes` | resource | **PASS** | 0 | {
  "count": 3,
  "routes": [
    {
      "path": "/",
      "file": "app/pages/index.vue",
      "absolutePath": "/tmp/… |
| `nuxt://project/config` | resource | **PASS** | 0 | {
  "configFile": "/tmp/mcp-nuxt-real-ZlS9KT/nuxt.config.ts",
  "sourceKind": "parsed",
  "value": {
    "compatibilityD… |
| `nuxt://project/modules` | resource | **PASS** | 0 | {
  "count": 1,
  "modules": [
    {
      "name": "nuxt",
      "version": "^4.6.4",
      "status": "inactive",
      … |
| `nuxt://project/layers` | resource | **PASS** | 0 | {
  "count": 1,
  "layers": [
    {
      "cwd": "/tmp/mcp-nuxt-real-ZlS9KT",
      "name": "mcp-nuxt-real-ZlS9KT",
    … |
| `nuxt://project/auto-imports` | resource | **PASS** | 0 | {
  "built": true,
  "count": 212,
  "imports": [
    {
      "name": "useScriptTriggerConsent",
      "source": "#app/c… |
| `nuxt://project/types` | resource | **PASS** | 1 | {
  "importsDts": "export { useScriptTriggerConsent, useScriptEventPage, useScriptTriggerElement, useScript, useScriptGo… |
| `add_route` | write | **PASS** | 0 | {"written":false,"dryRun":true,"path":"/tmp/mcp-nuxt-real-ZlS9KT/pages/e2e-dry.vue","content":"<script setup>\n</script>… |
| `generate_component` | write | **PASS** | 0 | {"written":false,"dryRun":true,"path":"/tmp/mcp-nuxt-real-ZlS9KT/components/E2eDryCard.vue","content":"<script setup lan… |
| `generate_composable` | write | **PASS** | 0 | {"written":false,"dryRun":true,"path":"/tmp/mcp-nuxt-real-ZlS9KT/composables/useE2eDry.ts","content":"export function us… |
| `scaffold_nitro_api` | write | **PASS** | 0 | {"written":false,"dryRun":true,"path":"/tmp/mcp-nuxt-real-ZlS9KT/server/api/e2e-dry.get.ts","content":"export default de… |
| `update_config` | write | **PASS** | 1 | {"ok":true,"written":false,"dryRun":true,"key":"ssr","configFile":"/tmp/mcp-nuxt-real-ZlS9KT/nuxt.config.ts","diff":"  /… |
| `session close (readonly)` | meta | **PASS** | 3658 | project=mcp-nuxt-real-ZlS9KT |
| `get_project_overview` | tool | **PASS** | 61 | {"root":"/tmp/mcp-nuxt-bare-FKocyV","name":"mcp-nuxt-real-ZlS9KT","framework":"Nuxt","nuxtVersion":"4.6.4","hasNuxtConfi… |
| `get_auto_imports` | tool | **PASS** | 1 | {"built":false,"count":0,"total":0,"imports":[],"hint":"No .nuxt/imports.d.ts found. Run `nuxi prepare` (or `nuxi build`… |
| `analyze_project` | tool | **PASS** | 1 | {"name":"mcp-nuxt-real-ZlS9KT","nuxtVersion":"4.6.4","built":false,"hasNuxtConfig":true,"counts":{"routes":3,"components… |
| `list_routes` | tool | **PASS** | 0 | {"count":3,"total":3,"routes":[{"path":"/","file":"app/pages/index.vue","absolutePath":"/tmp/mcp-nuxt-bare-FKocyV/app/pa… |
| `list_components` | tool | **PASS** | 0 | {"count":1,"total":1,"limit":20,"offset":0,"truncated":false,"components":[{"name":"BaseBadge","file":"app/components/Ba… |
| `session close (readonly)` | meta | **PASS** | 2216 | project=mcp-nuxt-bare-FKocyV |
| `add_route` | write | **PASS** | 4 | {"written":true,"path":"/tmp/mcp-nuxt-real-ZlS9KT/pages/e2e-live.vue"} |
| `generate_component` | write | **PASS** | 1 | {"written":true,"path":"/tmp/mcp-nuxt-real-ZlS9KT/components/E2eLiveCard.vue"} |
| `generate_composable` | write | **PASS** | 1 | {"written":true,"path":"/tmp/mcp-nuxt-real-ZlS9KT/composables/useE2eLive.ts"} |
| `scaffold_nitro_api` | write | **PASS** | 0 | {"written":true,"path":"/tmp/mcp-nuxt-real-ZlS9KT/server/api/e2e-live.get.ts"} |
| `update_config` | write | **PASS** | 54 | {"ok":true,"written":true,"key":"ssr","configFile":"/tmp/mcp-nuxt-real-ZlS9KT/nuxt.config.ts","diff":"  // https://nuxt.… |
| `session close (writes)` | meta | **PASS** | 2203 | project=mcp-nuxt-real-ZlS9KT |
| `nuxi prepare after writes` | meta | **PASS** | 2914 | types regenerated |


## Failures

_None_
