import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createRegionalFallbackProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("regional mutation capture retains hairpins with coincident boundary anchors", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "hairpin-node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [],
  }
  const route: PreloadedHighDensityRoute = {
    connectionName: "fixed-hairpin",
    rootConnectionName: "net",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    preloadedRoutePositionStart: 37,
    preloadedRoutePositionEnd: 39,
    traceThickness: 0.1,
    viaDiameter: 0.45,
    route: [
      { x: 2, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 0.85, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1.5, y: 0, z: 1 },
    ],
    vias: [],
  }
  const problem = createRegionalFallbackProblem(node, [route])
  const section = problem.fixedRouteSectionsByConnectionName.get(
    route.connectionName,
  )!
  expect(section).toBeDefined()
  expect(section.start.point).toEqual(section.end.point)
  expect(section.sourceRoutes).toEqual([route])
  expect(section.end.segmentIndex).toBeGreaterThan(section.start.segmentIndex)

  const touchingOnly = { ...route, route: route.route.filter((p) => p.x >= 1) }
  expect(
    createRegionalFallbackProblem(node, [touchingOnly])
      .fixedRouteSectionsByConnectionName.size,
  ).toBe(0)
})
