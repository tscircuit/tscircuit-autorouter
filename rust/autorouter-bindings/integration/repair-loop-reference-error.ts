import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import type { GlobalDrcBranchPortfolioSolverParams } from "high-density-repair03/lib"
import { GlobalDrcBranchPortfolioSolver } from "../../../lib/bindings/repair/GlobalDrcBranchPortfolioSolver"
import type { RepairPortfolioDescriptor } from "../../../lib/bindings/repair/repairPortfolio"
import * as bindings from "../pkg/autorouter_bindings.js"
import { loadAutorouterBindings } from "../ts/index"

await loadAutorouterBindings({ module_or_path: readFileSync(new URL("../pkg/autorouter_bindings_bg.wasm", import.meta.url)) })

const srj: GlobalDrcBranchPortfolioSolverParams["srj"] = {
  layerCount: 2,
  minTraceWidth: 0.1,
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  obstacles: [],
  connections: [],
}
const params: GlobalDrcBranchPortfolioSolverParams = {
  srj,
  hdRoutes: [],
  broadMaxIterations: 1,
  broadPassMultiplier: 1,
}
const descriptor: RepairPortfolioDescriptor = {
  engineSrj: srj,
  engineOptions: {},
  solverSrj: srj,
  connMap: null,
  originalTraces: [],
  newConnections: [],
  originalConnections: [],
  layerCount: 2,
  defaultViaHoleDiameter: 0.15,
  obstacles: [],
  movablePreloadedSections: [],
  nonMovableMutatedPreloadedTraces: [],
}
const sentinel = new Error("Reference DRC sentinel")
let calls = 0
const throwingReference = (): never => {
  calls++
  throw sentinel
}

for (const method of ["step", "evaluateRoutes"] as const) {
  const binding = new bindings.GlobalDrcBranchPortfolioSolver(params, descriptor, throwingReference)
  try {
    assert.throws(() => method === "step" ? binding.step() : binding.evaluateRoutes([]), (error: unknown): boolean => error === sentinel)
    assert.equal(binding.state().stats.indexedDrcCandidateCacheSize, 0, "Failed reference validation must not enter the candidate cache")
  } finally {
    // This must succeed: the Rust evaluator and wasm-bindgen solver borrows
    // must have unwound before the original exception reaches JavaScript.
    binding.free()
  }
}

const adapter = new GlobalDrcBranchPortfolioSolver(params, descriptor, throwingReference)
assert.throws(() => adapter._step(), (error: unknown): boolean => error === sentinel)
assert.throws(() => adapter._step(), /Repair portfolio has been disposed/)
assert.equal(calls, 3)
console.log("Reference callback exceptions preserve identity and release native borrows")
