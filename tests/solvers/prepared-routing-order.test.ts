import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { PreparedPortPointRoutingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/prepared/PreparedPortPointRoutingSolver"
import { RegionDistancePreparationSolver, type RegionDistancePreparationInput } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/prepared/RegionDistancePreparationSolver"
import { createPreparedRoutingFixture } from "../fixtures/createPreparedRoutingFixture"

test("reverse preparation completion preserves routes and resumable iteration boundaries", async (): Promise<void> => {
  const input = createPreparedRoutingFixture()
  const baseline = new PreparedPortPointRoutingSolver(input.topology, input.problem, input.options)
  baseline.solve()
  const pending: Array<() => void> = []
  const runtime = {
    executeAsync: (Solver: typeof RegionDistancePreparationSolver, task: RegionDistancePreparationInput) => new Promise(resolve => {
      const isolated = structuredClone(task)
      pending.push((): void => {
        const solver = new Solver(isolated)
        solver.solve()
        resolve(solver.getOutput())
      })
    }),
  } as SolverRuntimeExecutor
  const parallel = new PreparedPortPointRoutingSolver(input.topology, input.problem, input.options)
  await parallel.solveAsync(runtime, 0)
  expect(pending).toHaveLength(0)
  const prefix = parallel.solveAsync(runtime, 3)
  expect(pending).toHaveLength(4)
  while (pending.length) pending.pop()!()
  await prefix
  expect(parallel.iterations).toBe(3)
  await parallel.solveAsync(runtime)
  expect(parallel.solved).toBe(true)
  expect(parallel.state.regionSegments).toEqual(baseline.state.regionSegments)
  expect(parallel.iterations).toBe(baseline.iterations)
})
