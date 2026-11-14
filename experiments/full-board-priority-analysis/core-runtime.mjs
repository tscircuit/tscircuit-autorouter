// Benchmark runs can select a source-built core while retaining the published
// runtime for reproducing the previous baseline.
const core = await import(process.env.FULL_BOARD_CORE_MODULE ?? new URL("./patched-core/index.js", import.meta.url).href)
export const RootCircuit = core.RootCircuit
export const SOLVERS = core.SOLVERS
export const getSimpleRouteJsonFromCircuitJson = core.getSimpleRouteJsonFromCircuitJson
