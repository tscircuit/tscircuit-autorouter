import { expect, test } from "bun:test"
import type { HighDensityRouteObstacle } from "@tscircuit/high-density-b01"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const node: NodeWithPortPoints = {
  capacityMeshNodeId: "local_node",
  center: { x: 0, y: 0 },
  width: 2,
  height: 2,
  availableZ: [0, 1],
  portPoints: [],
}

const createSolver = (fixedHdRoutes: PreloadedHighDensityRoute[]) =>
  new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes,
    connMap: new ConnectivityMap({}),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    enableRegionalFallback: false,
  })

const createFixedRoute = (
  route: PreloadedHighDensityRoute["route"],
): PreloadedHighDensityRoute => ({
  connectionName: "fixed_trace",
  rootConnectionName: "fixed_net",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route,
  vias: [],
  preloadedTraceIndex: 0,
  preloadedRouteIndex: 0,
})

test("Pipeline9 only loads local fixed-trace geometry into B01", () => {
  const distantUShape = createFixedRoute([
    { x: -5, y: -5, z: 0 },
    { x: -5, y: 5, z: 0 },
    { x: 5, y: 5, z: 0 },
    { x: 5, y: -5, z: 0 },
  ])
  const solver = createSolver([distantUShape])

  solver.step()

  expect(solver.activeB01Solver).not.toBeNull()
  expect(solver.activeB01Solver!.obstacles).toEqual([])
  expect(solver.stats.fixedObstacleUses).toBe(0)
})

test("Pipeline9 clips crossing fixed traces to the local B01 window", () => {
  const crossingRoute = createFixedRoute([
    { x: -10, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  ])
  const solver = createSolver([crossingRoute])

  solver.step()

  const obstacles = solver.activeB01Solver!.obstacles
  expect(obstacles).toHaveLength(1)
  const routeObstacle = obstacles[0] as HighDensityRouteObstacle
  expect(routeObstacle.type).toBe("route")
  expect(routeObstacle.route).toHaveLength(2)
  expect(routeObstacle.route[0]!.x).toBeCloseTo(-1.3)
  expect(routeObstacle.route[1]!.x).toBeCloseTo(1.3)
  expect(
    routeObstacle.route.every((point) => point.y === 0 && point.z === 0),
  ).toBeTrue()
  expect(solver.stats.fixedObstacleUses).toBe(1)
})
