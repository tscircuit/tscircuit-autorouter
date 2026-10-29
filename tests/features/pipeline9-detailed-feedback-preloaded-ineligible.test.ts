import { expect, test } from "bun:test"
import { Pipeline9DetailedFeedbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9DetailedFeedbackSolver"
import { createDetailedFeedbackFixture } from "../fixtures/detailed-feedback/createDetailedFeedbackFixture"

test("preloaded copper is explicitly ineligible and never probed or repriced", (): void => {
  for (const withExplicitPreload of [false, true]) {
    const params = createDetailedFeedbackFixture()
    if (withExplicitPreload) params.hasPreloadedCopper = true
    else params.highDensityParams.fixedHdRoutes = [{ connectionName: "preload", traceThickness: 0.1,
      preloadedTraceIndex: 0, preloadedRouteIndex: 0,
      viaDiameter: 0.3, vias: [], route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] }]
    const solver = new Pipeline9DetailedFeedbackSolver(params)
    expect(solver.solved).toBe(true)
    expect(solver.stats.fixedCopperIneligible).toBe(true)
    expect(solver.stats.probeWork).toBe(0)
    expect(solver.stats.replansStarted).toBe(0)
    expect(solver.stats.changedAssignments).toBe(0)
    expect(solver.stats.setupWork).toBeGreaterThan(0)
    expect(solver.selectedPathingSolver).toBe(params.initialPathingSolver)
  }
})
