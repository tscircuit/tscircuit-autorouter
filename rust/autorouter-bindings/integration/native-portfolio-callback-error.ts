import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as bindings from "../pkg/autorouter_bindings.js"
import { loadAutorouterBindings } from "../ts/index"

type FailurePoint = "factory" | "setup" | "step" | null

await loadAutorouterBindings({ module_or_path: readFileSync(new URL("../pkg/autorouter_bindings_bg.wasm", import.meta.url)) })

const nodeJson = JSON.stringify({
  capacityMeshNodeId: "callback-error-fixture",
  center: { x: 0, y: 0 },
  width: 1,
  height: 1,
  availableZ: [0],
  portPoints: [],
})
const initialState = {
  iterations: 0,
  maxIterations: 100,
  solved: false,
  failed: false,
  error: null,
  progress: 0,
  solvedSegmentCount: null,
}

function createPortfolio(failurePoint: FailurePoint, sentinel: Error): bindings.PortfolioSingleIntraNodeSolver {
  let nextId = 0
  return new bindings.PortfolioSingleIntraNodeSolver(nodeJson, 1,
    (): string => {
      if (failurePoint === "factory") throw sentinel
      return JSON.stringify({ id: nextId++, kind: "external", state: initialState })
    },
    (_id: number, action: "setup" | "step", count: number): string => {
      assert.equal(count, action === "setup" ? 0 : 100)
      if (failurePoint === action) throw sentinel
      return JSON.stringify(action === "setup" ? initialState : {
        ...initialState, iterations: 1, solved: true, progress: 1,
      })
    },
    (): never => { throw new Error("External candidates must not access the General cache") },
  )
}

for (const failurePoint of ["factory", "setup", "step"] as const) {
  const sentinel = new Error(`Native portfolio ${failurePoint} sentinel`)
  const failing = createPortfolio(failurePoint, sentinel)
  try {
    assert.throws(() => failing.step(1), (error: unknown): boolean => error === sentinel)
  } finally {
    // Disposal must run after all Rust borrows unwind, preserving the original
    // callback exception instead of replacing it with a borrow failure.
    failing.free()
  }

  const fresh = createPortfolio(null, sentinel)
  try {
    assert.equal(fresh.step(1), 1)
    const state = fresh.snapshot() as { solved: boolean; failed: boolean; error: string | null }
    assert.equal(state.solved, true)
    assert.equal(state.failed, false)
    assert.equal(state.error, null)
  } finally {
    fresh.free()
  }
}
console.log("Native portfolio callback errors preserve identity, dispose cleanly, and allow fresh instances")
