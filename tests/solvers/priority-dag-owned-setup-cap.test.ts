import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PriorityDagIntraNodeSolver as Priority } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { detailedPriority, priorityParams } from "./priorityDagTestUtils"

test("owned setup is charged before selection and stops as UNKNOWN when the original family allocation is exhausted", () =>
  detailedPriority(() => {
    const params = priorityParams()
    const map = {
      giantRelevantNet: [
        ...Array.from({ length: 6000 }, (_, i) => `p${i}`),
        "a",
        "b",
        "c",
      ],
    }
    const solver = new Priority({
      ...params,
      connMap: new ConnectivityMap(map),
      priorityFamilySize: 1,
    })
    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    expect(solver.error).toContain("UNKNOWN: owned setup")
    expect(
      solver.priorityDiagnostics.priorityOwnerMemberVisits,
    ).toBeGreaterThan(0)
    expect(solver.priorityDiagnostics.priorityNativeSearches).toBeUndefined()
    expect(solver.iterations).toBeLessThanOrEqual(solver.MAX_ITERATIONS)
    expect(solver.priorityDiagnostics.priorityWorkUnits).toBe(solver.iterations)
    expect(solver.priorityDiagnostics.priorityUnknownCandidates).toBe(1)
  }))
