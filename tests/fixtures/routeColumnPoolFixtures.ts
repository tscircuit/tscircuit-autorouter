import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import { RouteColumnPool, type RouteColumnPoolParams } from "lib/solvers/HighDensitySolver/RouteColumnPool"

export const columnRoute = (name: string, points: { x: number; y: number; z: number }[], vias: { x: number; y: number }[] = []): HighDensityIntraNodeRoute => ({
  connectionName: name,
  rootConnectionName: name,
  regionId: "columns",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: points,
  vias,
})

export const columnNode = (routes: HighDensityIntraNodeRoute[]): NodeWithPortPoints => ({
  capacityMeshNodeId: "columns",
  center: { x: 0, y: 0 },
  width: 12,
  height: 12,
  availableZ: [0, 1, 2, 3],
  portPoints: routes.flatMap((route) => [route.route[0]!, route.route.at(-1)!].map((point) => ({
    ...point, connectionName: route.connectionName, rootConnectionName: route.rootConnectionName,
  }))),
})

export const columnPool = (routes: HighDensityIntraNodeRoute[], overrides: Partial<RouteColumnPoolParams> = {}): RouteColumnPool => new RouteColumnPool({
  nodeWithPortPoints: columnNode(routes),
  layerCount: 4,
  traceWidth: 0.1,
  viaDiameter: 0.3,
  obstacleMargin: 0.1,
  viaHoleDiameter: 0.15,
  minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
  obstacles: [],
  workLimit: 100_000,
  diagnostics: {},
  ...overrides,
})
