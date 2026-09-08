// Bun's parent-relative resolution selects core within the pinned runtime's
// compatible dependencies without loading unrelated eval/CLI exports.
// The paired declaration keeps the second core/JSX type graph isolated.
const runtimeUrl = import.meta.resolve("tscircuit-for-pipeline9-fixtures")
const coreUrl = import.meta.resolve("@tscircuit/core", runtimeUrl)

export const { RootCircuit, getSimpleRouteJsonFromCircuitJson } = await import(
  coreUrl
)
