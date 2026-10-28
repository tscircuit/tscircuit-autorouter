import { expect, test } from "bun:test"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { createPipeline9ViaPlacementProposalHarness } from "./fixtures/pipeline9ViaPlacementProposalHarness"

test("force-improve host declines an invalid worker proposal and preserves validated incoming copper", () => {
  const { input, proposal, node, context } = createPipeline9ViaPlacementProposalHarness()
  const original = structuredClone(input)
  const solver = new Pipeline9HighDensityForceImproveSolver({ nodeWithPortPoints: [node], hdRoutes: [input],
    viaPlacementContext: context })
  // The existing worker result boundary is independent of the numerical proposal generator.
  ;(solver as unknown as { completedSample: unknown }).completedSample = { routes: [proposal], latestVisualization: {} }
  solver.step()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toEqual([original])
  expect(solver.stats.viaPlacementCandidateRejectionCount).toBe(1)
  expect(input).toEqual(original)
  expect(() => new Pipeline9HighDensityForceImproveSolver({ nodeWithPortPoints: [node], hdRoutes: [proposal],
    viaPlacementContext: context })).toThrow("input violates")
})
