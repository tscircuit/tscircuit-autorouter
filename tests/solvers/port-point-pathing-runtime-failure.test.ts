import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("pathing propagates worker capability errors to the containing phase", async (): Promise<void> => {
  const solver = new TinyHypergraphPortPointPathingSolver(structuredClone(input) as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0])
  solver.PARALLEL_COST_WARMUP_ITERATIONS = 0
  const runtime = { executeAsync: async (): Promise<never> => { throw new Error("worker disconnected") } } as SolverRuntimeExecutor
  await expect(solver.solveAsync(runtime)).rejects.toThrow("worker disconnected")
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toContain("worker disconnected")
})
