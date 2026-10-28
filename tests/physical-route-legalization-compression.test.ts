import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"

test("zero projection iterations isolate exact collinear compression while retaining terminals, vias, widths and conflicts", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    { connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3, route: [
      { x: -1, y: 0, z: 0 }, { x: -0.75, y: 0, z: 0 }, { x: -0.5, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }], vias: [{ x: 0, y: 0 }] },
    { connectionName: "b", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: 0.15, z: 0 }, { x: 1, y: 0.15, z: 0 }], vias: [] },
  ]
  const result = legalizeHighDensityRouteProposal({ routes, node: { capacityMeshNodeId: "test", center: { x: 0, y: 0 },
    width: 3, height: 3, portPoints: [] }, layerCount: 2, clearance: 0.1, maxIterations: 0 })
  expect(result.pointsAfter).toBeLessThan(result.pointsBefore)
  expect(result.lossAfter).toBe(result.lossBefore)
  expect(result.copperPairsAfter).toBe(result.copperPairsBefore)
  expect(result.overlapPairsAfter).toBe(result.overlapPairsBefore)
  expect(result.routes[0]!.route).toEqual([routes[0]!.route[0]!, ...routes[0]!.route.slice(3)])
  expect(getPipeline9RouteCopperGeometry(result.routes[0]!, { layerCount: 2 }).viaSpans)
    .toEqual(getPipeline9RouteCopperGeometry(routes[0]!, { layerCount: 2 }).viaSpans)
})
