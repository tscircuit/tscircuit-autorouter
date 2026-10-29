import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { createFuturePointCacheStats, registerOwnedFuturePointCacheOptions } from "lib/solvers/HighDensitySolver/futurePointCacheContext"

export type Point = { x: number; y: number; z: number }
export const makeFuturePointOptions = (count: number, seed = 0): ConstructorParameters<typeof Native>[0] => {
  const points = Array.from({ length: count }, (_, index) => ({
    x: ((index * 17 + seed) % 43 - 21) * 0.1,
    y: ((index * 31 + seed * 3) % 47 - 23) * 0.1,
    z: index % 4,
  }))
  return { connectionName: "current", obstacleRoutes: [], minDistBetweenEnteringPoints: 0.05,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    A: { x: -2.8, y: -2.8, z: 0 }, B: { x: 2.8, y: 2.8, z: 3 }, layerCount: 4,
    availableZ: [0, 1, 2, 3], futureConnections: [{ connectionName: "future", points }], captureSearchDebug: false }
}
export const makeOwnedFuturePointSolver = (count: number, seed = 0) => {
  const stats = createFuturePointCacheStats()
  const opts = makeFuturePointOptions(count, seed)
  registerOwnedFuturePointCacheOptions(opts, stats)
  return { solver: new Native(opts), stats }
}
export const queryNode = (x: number, y: number, z: number): Node => {
  return { x, y, z, g: 0, h: 0, f: 0, parent: null }
}
export const makeFutureCacheNode = (seed = 0): NodeWithPortPoints => {
  const count = 5 + seed % 3
  const portPoints: NodeWithPortPoints["portPoints"] = []
  for (let index = 0; index < count; index++) {
    const angle = Math.PI * index / count
    const x = 1.8 * Math.cos(angle), y = 1.8 * Math.sin(angle)
    portPoints.push({ connectionName: `net${index}`, x: -x, y: -y, z: 0 }, { connectionName: `net${index}`, x, y, z: seed % 2 })
  }
  return { capacityMeshNodeId: `future-cache-synthetic-${seed}`, center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1], portPoints }
}
