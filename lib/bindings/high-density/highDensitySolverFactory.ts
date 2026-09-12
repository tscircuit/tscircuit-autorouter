import { initializeAutorouterBindings } from "lib/bindings/initializeAutorouterBindings"
import { HighDensitySolverAdapter, type HighDensityProps, type HighDensityVariant } from "../../../rust/capacity-autorouter-bindings/ts/index"

const wasmSolvers = new WeakSet<object>()

export function createHighDensityCandidateSolver<V extends HighDensityVariant>(variant: V, props: HighDensityProps[V]): HighDensitySolverAdapter<V> {
  initializeAutorouterBindings()
  const solver = new HighDensitySolverAdapter(variant, props)
  wasmSolvers.add(solver)
  return solver
}

export function isHighDensityCandidateSolver(solver: unknown): solver is HighDensitySolverAdapter {
  return typeof solver === "object" && solver !== null && wasmSolvers.has(solver)
}
