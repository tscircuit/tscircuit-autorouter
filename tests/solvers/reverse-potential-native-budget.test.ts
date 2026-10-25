import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { ReverseCostToGoCache } from "lib/solvers/HighDensitySolver/ReverseCostToGoCache"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { priorityParams } from "./priorityDagTestUtils"

class OrdinaryBudgetProbe extends IntraNodeRouteSolver {
  createNative(): Native {
    if (!this.unsolvedConnections[0])
      throw new Error("Budget fixture requires an unsolved native connection")
    const options = this.getSingleRouteSolverOpts(this.unsolvedConnections[0])
    const native = new Native(options)
    return native
  }
}

test("ordinary native candidates reserve oracle work within their existing remaining iteration allowance", () => {
  for (const remaining of [1, 25]) {
    const diagnostics: Record<string, number> = {}
    const cache = new ReverseCostToGoCache(diagnostics)
    const solver = new OrdinaryBudgetProbe({ ...priorityParams(), reversePotentialCache: cache })
    solver.iterations = solver.MAX_ITERATIONS - remaining
    const native = solver.createNative()
    const before = solver.iterations
    native.prepareReversePotential()
    expect(solver.iterations).toBeLessThanOrEqual(solver.MAX_ITERATIONS)
    expect(solver.iterations - before).toBeLessThanOrEqual(remaining)
    expect(diagnostics.reversePotentialBudgetBypasses).toBe(1)
    expect(cache.memoryBytes).toBe(0)
    expect(native.getReverseCostToGo({ ...native.A, g: 0, h: 0, f: 0, parent: null })).toBe(0)
    // The explicit optional-oracle budget policy leaves the existing native
    // search and physical guards available for the candidate's paid dispatch.
    expect(native.failed).toBe(false)
    expect(native.solved).toBe(false)
  }
})
