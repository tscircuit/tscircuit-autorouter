import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"

type ConnectionName = PortPoint["connectionName"]
type PhysicalPortPairKey = string
type RoutePoint = HighDensityIntraNodeRoute["route"][number]

function getPhysicalPortPairKey(params: {
  rootConnectionName: ConnectionName
  start: RoutePoint
  end: RoutePoint
}): PhysicalPortPairKey {
  const endpoints = [params.start, params.end].map((point) =>
    JSON.stringify([point.x, point.y, point.z]),
  )
  endpoints.sort()
  return JSON.stringify([params.rootConnectionName, ...endpoints])
}

/** Each physical pair must be routed once, even when several names alias it. */
export function getNativeRouteValidationError(
  routes: HighDensityIntraNodeRoute[],
  node: NodeWithPortPoints,
): string | null {
  const portPointsByConnection = new Map<ConnectionName, PortPoint[]>()
  for (const portPoint of node.portPoints) {
    const portPoints = portPointsByConnection.get(portPoint.connectionName)
    if (portPoints) portPoints.push(portPoint)
    else portPointsByConnection.set(portPoint.connectionName, [portPoint])
  }
  const pairs = node.portPointsInPairs?.length
    ? node.portPointsInPairs
    : [...portPointsByConnection.values()].flatMap(getConnectionPortPointPairs)
  const remainingPairs = new Map<PhysicalPortPairKey, Set<ConnectionName>>()
  for (const [start, end] of pairs) {
    if (start.x === end.x && start.y === end.y && start.z === end.z) continue
    const pairKey = getPhysicalPortPairKey({
      rootConnectionName: start.rootConnectionName ?? start.connectionName,
      start,
      end,
    })
    const names = remainingPairs.get(pairKey)
    if (names) names.add(start.connectionName)
    else remainingPairs.set(pairKey, new Set([start.connectionName]))
  }

  const minX = node.center.x - node.width / 2
  const maxX = node.center.x + node.width / 2
  const minY = node.center.y - node.height / 2
  const maxY = node.center.y + node.height / 2
  const availableZ = new Set(
    node.availableZ ?? node.portPoints.map((point) => point.z),
  )
  for (const route of routes) {
    for (const point of [...route.route, ...route.vias]) {
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < minX - 1e-9 ||
        point.x > maxX + 1e-9 ||
        point.y < minY - 1e-9 ||
        point.y > maxY + 1e-9
      ) {
        return "Route leaves the original node bounds or has non-finite coordinates"
      }
    }
    if (
      route.route.some(
        (point) => !Number.isInteger(point.z) || !availableZ.has(point.z),
      )
    ) {
      return "Route uses an unavailable layer"
    }
    if (route.route.length < 2) return "Route does not cover a physical port pair"
    const pairKey = getPhysicalPortPairKey({
      rootConnectionName: route.rootConnectionName ?? route.connectionName,
      start: route.route[0]!,
      end: route.route.at(-1)!,
    })
    if (!remainingPairs.get(pairKey)?.has(route.connectionName)) {
      return "Route has unexpected, duplicate, or inexact physical endpoints"
    }
    remainingPairs.delete(pairKey)
  }
  return remainingPairs.size > 0 ? "Route output omits physical port pairs" : null
}
