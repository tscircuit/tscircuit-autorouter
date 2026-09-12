import assert from "node:assert/strict"
import * as binding from "../pkg/autorouter_bindings.js"
import { HighDensitySolver } from "../../../lib/solvers/HighDensitySolver/HighDensitySolver"
import { PortfolioSingleIntraNodeSolver } from "../../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { PortfolioCallbackScope } from "../../../lib/bindings/high-density/PortfolioCallbackScope"
import { InMemoryCache } from "../../../lib/cache/InMemoryCache"
import type { NodeWithPortPoints } from "../../../lib/types/high-density-types"

type FreeOwner = { free(): void }
const solverTypes = ["GrowShrinkHighDensityIntraNodeSolver", "PortfolioSingleIntraNodeSolver", "IntraNodeRouteSolver", "HighDensityCandidateSolver", "SpecializedIntraNodeDispatcher"] as const
const counts = new Map<string, number>()
const originals: Array<{ prototype: FreeOwner; free: () => void }> = []
const node: NodeWithPortPoints = {
  capacityMeshNodeId: "resource-lifetime", center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
  portPoints: [
    { connectionName: "a", x: -1, y: 0, z: 0 }, { connectionName: "a", x: 1, y: 0, z: 0 },
    { connectionName: "b", x: 0, y: -1, z: 0 }, { connectionName: "b", x: 0, y: 1, z: 0 },
  ],
}
function createBoard(): HighDensitySolver {
  globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = new InMemoryCache()
  return new HighDensitySolver({ nodePortPoints: [structuredClone(node)], colorMap: { a: "red", b: "blue" },
    useGrowShrinkHighDensityIntraNodeSolver: true })
}

// Count explicit frees before yielding: finalizers cannot substitute for releasing
// successful unobserved children during one synchronous whole-board solve.
try {
  for (const name of solverTypes) {
    const prototype = binding[name].prototype
    const free = prototype.free
    originals.push({ prototype, free })
    prototype.free = function (this: FreeOwner): void {
      counts.set(name, (counts.get(name) ?? 0) + 1)
      free.call(this)
    }
  }

  const unobserved = createBoard()
  unobserved.solve()
  assert.equal(unobserved.solved, true)
  assert.equal(unobserved.routes.length, 2)
  for (const name of solverTypes) assert.ok((counts.get(name) ?? 0) > 0, `${name} must be released synchronously`)
  const freed = Object.fromEntries(counts)

  counts.clear()
  const observed = createBoard()
  observed.step()
  const retained = observed.activeSubSolver
  assert.ok(retained)
  observed.solve()
  assert.equal(observed.solved, true)
  assert.deepEqual(counts, new Map(), "Observed children must remain usable")
  assert.ok(retained.visualize())
  assert.equal(retained.solvedRoutes.length, 2)

  counts.clear()
  globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = new InMemoryCache()
  const portfolio = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints: structuredClone(node), colorMap: { a: "red", b: "blue" } })
  const originalOnSolve = portfolio.onSolve
  let retainedWinner: Parameters<PortfolioSingleIntraNodeSolver["onSolve"]>[0]["solver"] | undefined
  portfolio.onSolve = (entry): void => {
    retainedWinner = entry.solver
    originalOnSolve.call(portfolio, entry)
  }
  const scope = new PortfolioCallbackScope()
  const growthBinding = new binding.GrowShrinkHighDensityIntraNodeSolver(
    JSON.stringify({ nodeWithPortPoints: node }),
    (): number => scope.adopt(portfolio),
    undefined,
    (): string => JSON.stringify(portfolio.visualize()),
  )
  scope.run((): void => growthBinding.solve())
  assert.equal(portfolio.getPortfolioAdapter().disposeUnobserved(), false, "Custom onSolve can retain its winner before any public state read")
  assert.equal(portfolio.solved, true)
  assert.ok(retainedWinner)
  assert.deepEqual(counts, new Map(), "Custom onSolve must protect the shared portfolio and candidates")
  assert.ok(retainedWinner.visualize())
  growthBinding.free()
  console.log(JSON.stringify({ freedSynchronously: freed, observedChildRetained: true, customOnSolveWinnerRetained: true }))
} finally {
  for (const { prototype, free } of originals) prototype.free = free
}
