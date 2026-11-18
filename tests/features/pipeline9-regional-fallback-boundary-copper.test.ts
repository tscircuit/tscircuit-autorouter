import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createRegionalFallbackProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("Pipeline9 retains copper that only touches a regional boundary", (): void => {
  const boundaryRoute: PreloadedHighDensityRoute = {
    connectionName: "ddr_address",
    rootConnectionName: "ddr_address",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    traceThickness: 0.0889,
    viaDiameter: 0.28,
    route: [
      { x: 0.2, y: -0.2, z: 0 },
      { x: 0, y: -0.2, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: -0.399999, y: -0.000001, z: 0 },
      { x: -0.4, y: -0.2, z: 0 },
    ],
    vias: [],
  }
  const original = structuredClone(boundaryRoute)

  // The second boundary has the rounding error captured on the ECP5 board.
  for (const boundaryY of [0, -1.8e-14]) {
    const node: NodeWithPortPoints = {
      capacityMeshNodeId: "boundary_contact",
      center: { x: 0, y: 1 + boundaryY },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints: [
        { x: -1, y: 1, z: 0, connectionName: "new_signal" },
        { x: 1, y: 1, z: 0, connectionName: "new_signal" },
      ],
    }
    const problem = createRegionalFallbackProblem(node, [boundaryRoute])

    expect(problem.fixedRouteSectionsByConnectionName.size).toBe(0)
    expect(problem.fixedObstacleRoutes).toEqual([boundaryRoute])
    expect(problem.nodeWithPortPoints.portPoints).toEqual(node.portPoints)
    expect(boundaryRoute).toEqual(original)
  }
})
