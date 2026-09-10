import type { HighDensityProps, HighDensityVariant, WasmHighDensitySolver } from "../../../rust/high-density-wasm/ts/index"

export type HighDensityBackend = {
  createSolver: <V extends HighDensityVariant>(variant: V, props: HighDensityProps[V]) => WasmHighDensitySolver<V>
}

let backend: HighDensityBackend | undefined
const wasmSolvers = new WeakSet<object>()

export function registerHighDensityBackend(value: HighDensityBackend): void {
  if (backend && backend !== value) {
    throw new Error("A high-density backend is already registered")
  }
  backend = value
}

export function createWasmHighDensitySolver<V extends HighDensityVariant>(variant: V, props: HighDensityProps[V]): WasmHighDensitySolver<V> | undefined {
  if (!backend) return undefined
  const solver = backend.createSolver(variant, props)
  wasmSolvers.add(solver)
  return solver
}

export function isWasmHighDensitySolver(solver: unknown): solver is WasmHighDensitySolver {
  return typeof solver === "object" && solver !== null && wasmSolvers.has(solver)
}
