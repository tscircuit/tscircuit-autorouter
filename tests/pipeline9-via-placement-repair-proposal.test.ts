import { expect, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { createPipeline9ViaPlacementProposalHarness } from "./fixtures/pipeline9ViaPlacementProposalHarness"

test("repair host declines an invalid worker proposal without treating invalid input as valid", () => {
  const { input, proposal, node, context, srj } = createPipeline9ViaPlacementProposalHarness()
  const original = structuredClone(input)
  const solver = new Pipeline4HighDensityRepairSolver({ nodeWithPortPoints: [node], hdRoutes: [input],
    obstacles: srj.obstacles, viaPlacementContext: context })
  ;(solver as unknown as { consumeRepairSample: (result: unknown) => void }).consumeRepairSample({
    repairedRoutes: [proposal], clearanceStats: {},
  })
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toEqual([original])
  expect(solver.stats.viaPlacementCandidateRejectionCount).toBe(1)
  expect(input).toEqual(original)
  expect(() => new Pipeline4HighDensityRepairSolver({ nodeWithPortPoints: [node], hdRoutes: [proposal],
    obstacles: srj.obstacles, viaPlacementContext: context })).toThrow("input violates")
})
