import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

type TinyPipelineTestHarness = {
  activeSubSolver?: { step(): void } | null
  failed: boolean
  solved: boolean
  getCurrentStageName(): string
  step(): void
}

type TinyHypergraphParams = ConstructorParameters<
  typeof TinyHypergraphPortPointPathingSolver
>[0]

test("TinyHypergraph port-point pathing propagates pipeline errors", () => {
  const params = structuredClone(input) as TinyHypergraphParams
  params.flags.USE_SELECTIVE_RERIP_ROUTING = true
  params.flags.CREATE_FINAL_APPROXIMATION_ON_TIMEOUT = true
  const solver = new TinyHypergraphPortPointPathingSolver(params)
  const pipeline = (
    solver as unknown as { tinyPipelineSolver: TinyPipelineTestHarness }
  ).tinyPipelineSolver

  while (pipeline.getCurrentStageName() !== "optimizeSection") {
    if (pipeline.solved || pipeline.failed) {
      throw new Error("Pipeline ended before reaching optimizeSection")
    }
    pipeline.step()
  }

  pipeline.step()
  const optimizeSectionSolver = pipeline.activeSubSolver
  if (!optimizeSectionSolver) {
    throw new Error("optimizeSection solver was not initialized")
  }

  optimizeSectionSolver.step = () => {
    throw new Error("forced optimize-section failure")
  }

  expect(() => solver.step()).toThrow("forced optimize-section failure")
  expect(pipeline.solved).toBe(false)
  expect(pipeline.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
})
