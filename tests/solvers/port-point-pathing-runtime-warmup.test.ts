import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

type Params = ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]

test("short searches finish during warmup without dispatching cost workers", async (): Promise<void> => {
  const serial = new TinyHypergraphPortPointPathingSolver(structuredClone(input) as Params)
  serial.solve()
  const runtime = { executeAsync: async (): Promise<never> => { throw new Error("short search dispatched") } } as SolverRuntimeExecutor
  const solver = new TinyHypergraphPortPointPathingSolver(structuredClone(input) as Params)
  await solver.solveAsync(runtime, 50)
  expect(solver.iterations).toBe(Math.min(50, serial.iterations))
  await solver.solveAsync(runtime)
  expect(solver.solved).toBe(true)
  expect(solver.iterations).toBe(serial.iterations)
  expect(solver.getOutput()).toEqual(serial.getOutput())
})
