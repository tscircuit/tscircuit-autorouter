import { expect, test } from "bun:test"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { seededRandom } from "lib/utils/cloneAndShuffleArray"

type SeededViaDetourCase = {
  seed: number
  optimalRoute: HighDensityRoute
  routeWithAddedVias: HighDensityRoute
  obstacles: Obstacle[]
}

const TRACE_THICKNESS = 0.15
const VIA_DIAMETER = 0.4
const CLEARANCE = 0.1

const createSeededViaDetourCase = (seed: number): SeededViaDetourCase => {
  const random = seededRandom(seed)
  const obstacleWidth = 0.8 + random() * 1.4
  const obstacleHeight = 0.8 + random() * 1.4
  const obstacleCenter = {
    x: 4 + random() * 2,
    y: -0.3 + random() * 0.6,
  }
  const obstacle: Obstacle = {
    type: "rect",
    layers: ["top"],
    __zLayers: [0],
    center: obstacleCenter,
    width: obstacleWidth,
    height: obstacleHeight,
    connectedTo: ["blocking_net"],
  }
  const routeY = obstacleCenter.y
  const side = random() < 0.5 ? -1 : 1
  const viaObstacleClearance = VIA_DIAMETER / 2 + CLEARANCE + 0.1
  const leftX = obstacleCenter.x - obstacleWidth / 2 - viaObstacleClearance
  const rightX = obstacleCenter.x + obstacleWidth / 2 + viaObstacleClearance
  const detourY =
    obstacleCenter.y +
    side * (obstacleHeight / 2 + TRACE_THICKNESS / 2 + CLEARANCE + 0.1)
  const connectionName = `seeded_detour_${seed}`
  const optimalRoute: HighDensityRoute = {
    connectionName,
    traceThickness: TRACE_THICKNESS,
    viaDiameter: VIA_DIAMETER,
    route: [
      { x: 0, y: routeY, z: 0 },
      { x: leftX, y: routeY, z: 0 },
      { x: leftX, y: detourY, z: 0 },
      { x: rightX, y: detourY, z: 0 },
      { x: rightX, y: routeY, z: 0 },
      { x: 10, y: routeY, z: 0 },
    ],
    vias: [],
  }
  const routeWithAddedVias: HighDensityRoute = {
    ...optimalRoute,
    route: [
      { x: 0, y: routeY, z: 0 },
      { x: leftX, y: routeY, z: 0 },
      { x: leftX, y: routeY, z: 1 },
      { x: rightX, y: routeY, z: 1 },
      { x: rightX, y: routeY, z: 0 },
      { x: 10, y: routeY, z: 0 },
    ],
    vias: [
      { x: leftX, y: routeY },
      { x: rightX, y: routeY },
    ],
  }

  return {
    seed,
    optimalRoute,
    routeWithAddedVias,
    obstacles: [obstacle],
  }
}

const routeIsClear = (
  route: HighDensityRoute,
  obstacles: Obstacle[],
): boolean => {
  const traceClearance = route.traceThickness / 2 + CLEARANCE
  for (let index = 1; index < route.route.length; index++) {
    const start = route.route[index - 1]
    const end = route.route[index]
    if (start.z !== end.z) continue
    for (const obstacle of obstacles) {
      if (!obstacle.__zLayers?.includes(start.z)) continue
      if (segmentToBoxMinDistance(start, end, obstacle) < traceClearance) {
        return false
      }
    }
  }

  const viaClearance = route.viaDiameter / 2 + CLEARANCE
  return route.vias.every((via) =>
    obstacles.every((obstacle) => {
      const dx = Math.max(
        Math.abs(via.x - obstacle.center.x) - obstacle.width / 2,
        0,
      )
      const dy = Math.max(
        Math.abs(via.y - obstacle.center.y) - obstacle.height / 2,
        0,
      )
      return Math.hypot(dx, dy) >= viaClearance
    }),
  )
}

test("seeded added-via detours simplify back to the known optimum", () => {
  const failures: Array<{
    seed: number
    actualVias: number
    routeIsClear: boolean
    route: HighDensityRoute["route"]
  }> = []
  for (let seed = 1; seed <= 64; seed++) {
    const generated = createSeededViaDetourCase(seed)
    expect(routeIsClear(generated.optimalRoute, generated.obstacles)).toBe(true)
    expect(
      routeIsClear(generated.routeWithAddedVias, generated.obstacles),
    ).toBe(true)

    const solver = new TraceSimplificationSolver({
      hdRoutes: [generated.routeWithAddedVias],
      obstacles: generated.obstacles,
      connMap: new ConnectivityMap({
        [`seeded_net_${seed}`]: [generated.routeWithAddedVias.connectionName],
      }),
      colorMap: {},
      defaultViaDiameter: VIA_DIAMETER,
      layerCount: 2,
      enableCrossingViaReduction: true,
    })
    solver.solve()

    expect(solver.failed).toBe(false)
    const simplifiedRoute = solver.simplifiedHdRoutes[0]
    const simplifiedRouteIsClear = routeIsClear(
      simplifiedRoute,
      generated.obstacles,
    )
    if (
      simplifiedRoute.vias.length !== generated.optimalRoute.vias.length ||
      !simplifiedRouteIsClear
    ) {
      failures.push({
        seed: generated.seed,
        actualVias: simplifiedRoute.vias.length,
        routeIsClear: simplifiedRouteIsClear,
        route: simplifiedRoute.route,
      })
    }
  }

  expect(failures).toEqual([])
})
