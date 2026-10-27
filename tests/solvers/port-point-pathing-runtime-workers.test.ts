import { expect, test } from "bun:test"
import { SolverRuntime as BunRuntime } from "@tscircuit/solver-utils/runtime/bun"
import { SolverRuntime as NodeRuntime } from "@tscircuit/solver-utils/runtime/node"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

type Params = ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]

test("Bun and Node pathing workers preserve exact serial output and wrapper iterations", async (): Promise<void> => {
  const serial = new TinyHypergraphPortPointPathingSolver(structuredClone(input) as Params)
  serial.solve()
  expect(serial.solved).toBe(true)
  for (const platform of ["bun", "node"] as const) {
    for (const workerCount of [1, 4]) {
      const Runtime = platform === "bun" ? BunRuntime : NodeRuntime
      const runtime = new Runtime({ workerCount, workerUrl: new URL(`../../lib/runtime/${platform}.worker.ts`, import.meta.url), requireWorker: true })
      try {
        const solver = new TinyHypergraphPortPointPathingSolver(structuredClone(input) as Params)
        solver.PARALLEL_COST_WARMUP_ITERATIONS = 0
        await solver.solveAsync(runtime)
        expect(solver.solved).toBe(true)
        expect(solver.failed).toBe(false)
        expect(solver.iterations).toBe(serial.iterations)
        expect(solver.getOutput()).toEqual(serial.getOutput())
      } finally { await runtime.dispose() }
    }
  }
})
