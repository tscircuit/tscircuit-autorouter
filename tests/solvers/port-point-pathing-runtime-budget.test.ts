import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

type Params = ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]

test("bounded parallel pathing resumes without losing wrapper steps or terminal transitions", async (): Promise<void> => {
  const serial = new TinyHypergraphPortPointPathingSolver(structuredClone(input) as Params)
  serial.solve()
  const runtime = new SolverRuntime({ workerCount: 3, workerUrl: new URL("../../lib/runtime/bun.worker.ts", import.meta.url), requireWorker: true })
  try {
    for (const budget of [1, 2, 10, 50, serial.iterations - 1, serial.iterations]) {
      const solver = new TinyHypergraphPortPointPathingSolver(structuredClone(input) as Params)
      solver.PARALLEL_COST_WARMUP_ITERATIONS = 0
      await solver.solveAsync(runtime, budget)
      expect(solver.iterations).toBe(Math.min(budget, serial.iterations))
      await solver.solveAsync(runtime)
      expect(solver.iterations).toBe(serial.iterations)
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      expect(solver.getOutput()).toEqual(serial.getOutput())
    }
  } finally { await runtime.dispose() }
})
