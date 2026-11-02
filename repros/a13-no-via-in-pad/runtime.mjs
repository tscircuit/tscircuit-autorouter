const runtimeUrl = import.meta.resolve("tscircuit-for-a13-fixtures")
export const { RootCircuit } = await import(
  import.meta.resolve("@tscircuit/core", runtimeUrl)
)
export const { convertCircuitJsonToPcbSvg } = await import(
  import.meta.resolve("circuit-to-svg", runtimeUrl)
)
export const checks = await import(
  import.meta.resolve("@tscircuit/checks", runtimeUrl)
)
