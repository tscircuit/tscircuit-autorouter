import { expect, test } from "bun:test"
import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import fixture from "../../fixtures/bug-reports/rvboy-plated-hole-precision.json"
import { Pipeline9HighDensityForceImproveSampleSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSampleSolver"
import type { Obstacle } from "lib/types"

test("Pipeline9 preserves RVboy's plated-hole layer connection through cleanup", () => {
  // Unmodified force-improve sample and obstacle from RVboy's native input.
  const force = new Pipeline9HighDensityForceImproveSampleSolver(
    structuredClone(fixture.forceInput),
  )
  force.solve()
  expect(force.solved).toBe(true)
  expect(force.failed).toBe(false)

  const cleanup = new TraceSimplificationSolver({
    hdRoutes: force.getOutput().routes,
    obstacles: [fixture.obstacle as Obstacle],
    connMap: new ConnectivityMap({}),
    colorMap: fixture.forceInput.colorMap,
    defaultViaDiameter: 0.45,
    layerCount: 4,
    minTraceToPadEdgeClearance: 0.1,
    enableCrossingViaReduction: true,
  })
  const crossing = cleanup.hdRoutes[0].route[0]
  expect(crossing.toNextSegmentType).toBe("through_obstacle")
  expect(crossing.toNextSegmentCircuitJsonMetadata).toEqual(
    fixture.obstacle.circuitJsonMetadata,
  )
  cleanup.solve()
  expect(cleanup.solved).toBe(true)
  expect(cleanup.failed).toBe(false)
  expect(cleanup.simplifiedHdRoutes).toHaveLength(1)
  expect(cleanup.simplifiedHdRoutes[0].vias).toEqual([])
})
