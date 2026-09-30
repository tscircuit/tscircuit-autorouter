import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createRegionalFallbackProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const createFixedRoute = (
  connectionName: string,
  preloadedRouteIndex: number,
  preloadedRoutePositionStart: number,
  preloadedRoutePositionEnd: number,
  route: PreloadedHighDensityRoute["route"],
): PreloadedHighDensityRoute => ({
  connectionName,
  rootConnectionName: "source_trace_feedback",
  traceThickness: 0.1,
  viaDiameter: 0.45,
  route,
  vias: [],
  preloadedTraceIndex: 30,
  preloadedRouteIndex,
  preloadedRoutePositionStart,
  preloadedRoutePositionEnd,
})

test("keeps a zero-length off-target bridge in its contiguous fallback section", (): void => {
  const fixedRoutes = [
    createFixedRoute("fixed_0", 0, 0, 1, [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]),
    createFixedRoute("fixed_1", 1, 2, 2, [
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
    ]),
    createFixedRoute("fixed_2", 2, 3, 4, [
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ]),
    createFixedRoute("fixed_3", 3, 4, 5, [
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
    ]),
  ]
  const targetNode: NodeWithPortPoints = {
    capacityMeshNodeId: "target_node",
    center: { x: 1, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: [
      {
        portPointId: "target_port",
        connectionName: "source_trace_target",
        x: -1,
        y: 0,
        z: 0,
      },
    ],
  }

  const problem = createRegionalFallbackProblem(
    targetNode,
    fixedRoutes,
    new Set(["fixed_3"]),
  )
  const section = problem.fixedRouteSectionsByConnectionName.get("fixed_0")

  expect(section?.sourceRoutes.map((route) => route.connectionName)).toEqual([
    "fixed_0",
    "fixed_1",
    "fixed_2",
    "fixed_3",
  ])
  expect(problem.fixedObstacleRoutes).not.toContain(fixedRoutes[2])
})
