import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createRegionalFallbackProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("Pipeline9 retains a nonzero hairpin that enters and leaves at the same boundary point", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "hairpin-node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [],
  }
  const fixedRoute: PreloadedHighDensityRoute = {
    connectionName: "fixed-hairpin",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 2, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 0.85, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1.5, y: 0, z: 1 },
    ],
    vias: [],
  }
  const problem = createRegionalFallbackProblem(node, [fixedRoute])
  const section = problem.fixedRouteSectionsByConnectionName.get(
    fixedRoute.connectionName,
  )
  expect(section).toBeDefined()
  expect(section?.start.point).toEqual({ x: 1, y: 0, z: 1 })
  expect(section?.end.point).toEqual(section?.start.point)
  expect(section?.sourceRoutes).toEqual([fixedRoute])

  const touchingRoute = {
    ...fixedRoute,
    route: fixedRoute.route.filter((point) => point.x !== 0.85),
  }
  expect(
    createRegionalFallbackProblem(node, [touchingRoute])
      .fixedRouteSectionsByConnectionName.size,
  ).toBe(0)
})
