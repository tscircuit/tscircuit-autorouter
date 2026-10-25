import { getFixedObstacleViolations } from "@tscircuit/repair04"
import { getObstacleRouteConnectivity } from "../HyperHighDensitySolver/getObstacleRouteConnectivity"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import type { OwnerCutValidationContext } from "./validateOwnerCutRoutes"

/** Frozen immutable board copper is never an activatable route owner. */
export function createOwnerCutFixedCopperOracle(
  params: OwnerCutValidationContext & {
    nodeWithPortPoints: NodeWithPortPoints
    traceThickness: number
    traceMargin: number
    viaDiameter: number
  },
): (move: HighDensityIntraNodeRoute, charge: (units: number) => boolean) => boolean | undefined {
  const node = params.nodeWithPortPoints
  const reach = Math.max(params.traceThickness, params.viaDiameter) / 2 +
    Math.max(params.traceMargin, params.viaToPadClearance ?? 0) + 1e-6
  const obstacles = params.obstacles.filter((obstacle) => {
    const radius = Math.hypot(obstacle.width, obstacle.height) / 2
    return obstacle.center.x + radius >= node.center.x - node.width / 2 - reach &&
      obstacle.center.x - radius <= node.center.x + node.width / 2 + reach &&
      obstacle.center.y + radius >= node.center.y - node.height / 2 - reach &&
      obstacle.center.y - radius <= node.center.y + node.height / 2 + reach
  })
  const names = new Map(node.portPoints.map((point) => [point.connectionName, {
    connectionName: point.connectionName,
    rootConnectionName: point.rootConnectionName ?? point.connectionName.replace(/_mst\d+$/, ""),
  }]))
  const ownership = [...names.values()]
  const { connectedRouteNamesByObstacle } = getObstacleRouteConnectivity({
    obstacles, routes: ownership, connMap: params.connMap,
  })
  const fixed = obstacles.map((obstacle, index) => ({ ...obstacle,
    connectedTo: [...new Set([...obstacle.connectedTo,
      ...connectedRouteNamesByObstacle[index]!])],
  }))
  const srj: SimpleRouteJson = {
    layerCount: 2, allowBlindAndBuriedVias: false,
    minTraceWidth: params.traceThickness, minViaDiameter: params.viaDiameter,
    minViaHoleDiameter: params.viaHoleDiameter,
    minViaEdgeToPadEdgeClearance: params.viaToPadClearance,
    minViaHoleEdgeToViaHoleEdgeClearance: params.minViaHoleEdgeToViaHoleEdgeClearance,
    bounds: { minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2,
      maxY: node.center.y + node.height / 2 },
    obstacles: fixed,
    connections: ownership.map((owner) => ({ name: owner.connectionName,
      rootConnectionName: owner.rootConnectionName, pointsToConnect: [] })),
  }
  return (move, charge): boolean | undefined => {
    if (!charge(1 + fixed.length)) return undefined
    if (!fixed.length) return false
    const first = move.route[0]!, last = move.route.at(-1)!
    const relevant = fixed.filter((obstacle) => {
      const radius = Math.hypot(obstacle.width, obstacle.height) / 2 + reach
      return obstacle.center.x + radius >= Math.min(first.x, last.x) &&
        obstacle.center.x - radius <= Math.max(first.x, last.x) &&
        obstacle.center.y + radius >= Math.min(first.y, last.y) &&
        obstacle.center.y - radius <= Math.max(first.y, last.y)
    })
    if (!relevant.length) return false
    const work = 16 * (ownership.length + 1) + relevant.reduce((sum, obstacle) =>
      sum + 64 + 4 * obstacle.connectedTo.length, 0)
    if (!charge(work)) return undefined
    return getFixedObstacleViolations({ srj: { ...srj, obstacles: relevant },
      routes: [move], traceClearance: params.traceMargin,
      viaClearance: params.traceMargin }).length > 0
  }
}
