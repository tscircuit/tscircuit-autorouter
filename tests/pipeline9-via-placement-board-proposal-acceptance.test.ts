import { expect, test } from "bun:test"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import { createPipeline9ViaPlacementProposalHarness } from "./fixtures/pipeline9ViaPlacementProposalHarness"

test("force-improve, repair, and cache acceptance reject a via in the original board notch", (): void => {
  const { input, proposal, node, context, srj } = createPipeline9ViaPlacementProposalHarness()
  context.boardObstacles = []
  context.boardGeometry = { bounds: srj.bounds, minBoardEdgeClearance: 0,
    outline: [{ x: -3, y: -2 }, { x: 3, y: -2 }, { x: 3, y: 2 }, { x: 0.4, y: 2 },
      { x: 0.4, y: -0.4 }, { x: -0.4, y: -0.4 }, { x: -0.4, y: 2 }, { x: -3, y: 2 }] }
  const validate = getPipeline9ViaPlacementValidator(context)
  expect(validate({ ...input.vias[0]!, zStart: 1, zEnd: 3, viaDiameter: 0.3 }, "signal")).toBe(true)
  expect(validate({ ...proposal.vias[0]!, zStart: 1, zEnd: 3, viaDiameter: 0.3 }, "signal")).toBe(false)
  const original = structuredClone(input)
  const forceImprove = new Pipeline9HighDensityForceImproveSolver({ nodeWithPortPoints: [node],
    hdRoutes: [input], viaPlacementContext: context })
  ;(forceImprove as unknown as { completedSample: unknown }).completedSample = { routes: [proposal], latestVisualization: {} }
  forceImprove.step()
  expect(forceImprove.solved).toBe(true)
  expect(forceImprove.getOutput()).toEqual([original])
  expect(forceImprove.stats.viaPlacementCandidateRejectionCount).toBe(1)
  const repair = new Pipeline4HighDensityRepairSolver({ nodeWithPortPoints: [node], hdRoutes: [input],
    obstacles: [], viaPlacementContext: context })
  ;(repair as unknown as { consumeRepairSample: (result: unknown) => void }).consumeRepairSample({
    repairedRoutes: [proposal], clearanceStats: {},
  })
  expect(repair.solved).toBe(true)
  expect(repair.getOutput()).toEqual([original])
  expect(repair.stats.viaPlacementCandidateRejectionCount).toBe(1)
  const cached = new CachedIntraNodeRouteSolver({ nodeWithPortPoints: node, layerCount: 4,
    cacheProvider: null, viaPlacementValidator: validate })
  cached.applyCachedSolution({ success: true, solvedRoutes: [proposal] })
  expect(cached.solved).toBe(false)
  expect(cached.cacheHit).toBe(false)
  cached.applyCachedSolution({ success: true, solvedRoutes: [input] })
  expect(cached.solved).toBe(true)
  expect(cached.cacheHit).toBe(true)
  expect(cached.solvedRoutes).toEqual([original])
  expect(input).toEqual(original)
})
