import assert from "node:assert/strict"
import { PortfolioSingleIntraNodeSolver } from "../../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { PortfolioSolverAdapter } from "../../../lib/bindings/high-density/PortfolioSolverAdapter"

type Failure = "factory" | "setup" | "step"
type Internal = Pick<PortfolioSolverAdapter, "step" | "initialize" | "dispose"> & { callbackScope: { current: unknown } }
const node = { capacityMeshNodeId: "callback-scope", center: { x: 0, y: 0 }, width: 1, height: 1, availableZ: [0], portPoints: [] }
const originalWeakRef = globalThis.WeakRef
let callbacks = 0
// A synchronous job must not create or dereference WeakRefs to its portfolios.
// This asserts the ownership mechanism directly without depending on GC timing.
globalThis.WeakRef = class {
  constructor() { throw new Error("Portfolio callbacks must not keep owners through WeakRef") }
} as unknown as typeof WeakRef

function create(failure?: Failure, nested?: () => void): { owner: PortfolioSingleIntraNodeSolver; native: Internal; sentinel: Error } {
  const owner = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints: structuredClone(node) })
  const native = (owner as unknown as { portfolioAdapter: Internal }).portfolioAdapter
  const sentinel = new Error(`${failure} callback sentinel`)
  let didNest = false
  const check = (stage: Failure): void => {
    callbacks++
    assert.equal(native.callbackScope.current, native)
    if (failure === stage) throw sentinel
  }
  owner.generateSolver = (): ReturnType<PortfolioSingleIntraNodeSolver["generateSolver"]> => {
    check("factory")
    if (nested && !didNest) { didNest = true; nested(); assert.equal(native.callbackScope.current, native) }
    const candidate = {
      iterations: 0, MAX_ITERATIONS: 100, solved: false, failed: false, error: null, progress: 0, solvedRoutes: [],
      getSolverName(): string { return "ScopeFixtureSolver" },
      setup(): void { check("setup") },
      step(): void { check("step"); if (!this.solved) { this.iterations++; this.solved = true; this.progress = 1 } },
    }
    return candidate as unknown as ReturnType<PortfolioSingleIntraNodeSolver["generateSolver"]>
  }
  assert.equal(native.callbackScope.current, undefined)
  return { owner, native, sentinel }
}

try {
  const inner = create()
  const outer = create(undefined, (): void => {
    inner.owner.initializeSolvers()
    assert.equal(inner.native.callbackScope.current, undefined)
    inner.native.step()
    assert.equal(inner.native.callbackScope.current, undefined)
  })
  outer.owner.initializeSolvers()
  assert.equal(outer.native.callbackScope.current, undefined)
  outer.native.step()
  assert.equal(outer.owner.solved, true)
  assert.equal(inner.owner.solved, true)
  assert.equal(outer.native.callbackScope.current, undefined)
  for (const failure of ["factory", "setup", "step"] as const) {
    for (const operation of ["initialize", "step"] as const) {
      if (failure === "step" && operation === "initialize") continue
      const failing = create(failure)
      assert.throws(() => failing.native[operation](), (error: unknown): boolean => error === failing.sentinel)
      assert.equal(failing.native.callbackScope.current, undefined)
      failing.native.dispose()
      assert.equal(failing.native.callbackScope.current, undefined)
    }
  }
} finally {
  globalThis.WeakRef = originalWeakRef
}
console.log(`Portfolio callback scope: ${callbacks} callbacks, nested owners, exception cleanup, no WeakRef use`)
