import { expect, test } from "bun:test"
import { CopperCandidateCompatibilitySearch } from "lib/solvers/HighDensitySolver/CopperCandidateCompatibilitySearch"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { priorityParams } from "./priorityDagTestUtils"

test("candidate choice limits and the original aggregate work cap never publish an incomplete assignment", () => {
  const domains = [0, 1].map((task) => [{
    id: task, task, route: {
      connectionName: `net${task}`, regionId: "region", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: task, y: 0, z: 0 }, { x: task, y: 1, z: 0 }], vias: [],
    },
  }])
  const search = new CopperCandidateCompatibilitySearch({
    domains, maxAttempts: 1, charge: () => {}, conflict: () => false,
  })
  while (search.status === "searching") search.step()
  expect(search.status).toBe("limited")
  expect(search.solution).toBeUndefined()
  const solver = new PriorityDagIntraNodeSolver({ ...priorityParams(), copperCandidateSearch: true })
  solver.MAX_ITERATIONS = solver.iterations + 40
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("UNKNOWN")
  expect(solver.error).not.toContain("UNSAT")
  expect(solver.solvedRoutes).toHaveLength(0)
  expect(solver.iterations).toBeLessThanOrEqual(solver.MAX_ITERATIONS)
})
