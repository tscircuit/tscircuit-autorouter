import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

type TinyPipelineTestHarness = {
  solveGraph: { solver: { step(): unknown } }
  failed: boolean
  solved: boolean
}

type TinyHypergraphParams = ConstructorParameters<
  typeof TinyHypergraphPortPointPathingSolver
>[0]

test("TinyHypergraph port-point pathing propagates pipeline errors", () => {
  const solver = new TinyHypergraphPortPointPathingSolver(
    structuredClone(input) as TinyHypergraphParams,
  )
  const pipeline = (
    solver as unknown as { tinyPipelineSolver: TinyPipelineTestHarness }
  ).tinyPipelineSolver

  solver.step() // Construct the search stage before its first native tick.
  pipeline.solveGraph.solver.step = (): never => {
    throw new Error("forced native tiny-hypergraph failure")
  }

  expect(() => solver.step()).toThrow("forced native tiny-hypergraph failure")
  expect(pipeline.solved).toBe(false)
  expect(pipeline.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
})
