import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import { PreparedPortPointRoutingSolver } from "tiny-hypergraph/lib/prepared/PreparedPortPointRoutingSolver"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments as OriginalSolver } from "tiny-hypergraph/lib/prepared/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { createPreparedRoutingFixture } from "../fixtures/createPreparedRoutingFixture"

test("prepared routing matches the original search and completion with serial execution and reusable one/four-worker pools", async (): Promise<void> => {
  for (const workerCount of [1, 4]) {
    const runtime = new SolverRuntime({workerCount, workerUrl: new URL("../../lib/runtime/node.worker.ts", import.meta.url), requireWorker: true})
    try {
      for (const maxIterations of [1, 50_000]) {
        for (const density of [0, 0.7]) {
          const input = createPreparedRoutingFixture()
          const options = {...input.options, MAX_ITERATIONS: maxIterations, TRACE_DENSITY_COST_FACTOR: density}
          const original = new OriginalSolver(input.topology, input.problem, options)
          original.solve()
          const serial = new PreparedPortPointRoutingSolver(input.topology, input.problem, options)
          serial.solve()
          const parallel = new PreparedPortPointRoutingSolver(input.topology, input.problem, options)
          await parallel.solveAsync(runtime)
          expect(original.solved).toBe(true)
          for (const solver of [serial, parallel]) {
            expect(solver.solved).toBe(true)
            expect(solver.state.regionSegments).toEqual(original.state.regionSegments)
            expect(solver.state.portAssignment).toEqual(original.state.portAssignment)
            expect(solver.iterations).toBe(original.iterations)
          }
        }
      }
    } finally { await runtime.dispose() }
  }
})
