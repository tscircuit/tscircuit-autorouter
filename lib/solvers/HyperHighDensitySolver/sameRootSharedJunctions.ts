import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { repairDisconnectedSameRootPortPoints } from "./repairDisconnectedSameRootPortPoints"

const pointKey = (point: { x: number; y: number; z: number }) =>
  `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z}`

const sharedJunctionKey = (portPoint: PortPoint) =>
  [
    portPoint.rootConnectionName ?? portPoint.connectionName,
    pointKey(portPoint),
  ].join(":")

const uniquePhysicalPoints = <T extends { x: number; y: number; z: number }>(
  points: T[],
): T[] => {
  const seen = new Set<string>()
  const uniquePoints: T[] = []

  for (const point of points) {
    const key = pointKey(point)
    if (seen.has(key)) continue
    seen.add(key)
    uniquePoints.push(point)
  }

  return uniquePoints
}

export const normalizeSameRootSharedJunctions = (
  node: NodeWithPortPoints,
): {
  node: NodeWithPortPoints
  removedConnectionNames: Set<string>
} => {
  const seenJunctions = new Set<string>()
  const removedConnectionNames = new Set<string>()
  const portPoints = node.portPoints.filter((portPoint) => {
    const key = sharedJunctionKey(portPoint)
    if (seenJunctions.has(key)) {
      removedConnectionNames.add(portPoint.connectionName)
      return false
    }
    seenJunctions.add(key)
    return true
  })

  return {
    node:
      portPoints.length === node.portPoints.length
        ? node
        : {
            ...node,
            portPoints,
          },
    removedConnectionNames,
  }
}

const getConnectionPortPoints = (
  node: NodeWithPortPoints,
  connectionName: string,
) =>
  uniquePhysicalPoints(
    node.portPoints
      .filter((portPoint) => portPoint.connectionName === connectionName)
      .map((portPoint) => ({
        x: portPoint.x,
        y: portPoint.y,
        z: portPoint.z ?? 0,
      })),
  )

const routeTouchesConnectionPoint = (
  route: HighDensityIntraNodeRoute,
  point: { x: number; y: number; z: number },
) =>
  route.route.some(
    (routePoint) =>
      Math.abs(routePoint.x - point.x) < 1e-6 &&
      Math.abs(routePoint.y - point.y) < 1e-6 &&
      routePoint.z === point.z,
  )

const buildDirectSameRootRoute = (params: {
  connectionName: string
  rootConnectionName?: string
  points: Array<{ x: number; y: number; z: number }>
  traceThickness: number
  viaDiameter: number
}): HighDensityIntraNodeRoute | null => {
  const [start, end] = params.points
  if (!start || !end) return null

  if (
    Math.abs(start.x - end.x) < 1e-6 &&
    Math.abs(start.y - end.y) < 1e-6 &&
    start.z === end.z
  ) {
    return null
  }

  const route =
    start.z === end.z
      ? [start, end]
      : [start, { x: start.x, y: start.y, z: end.z }, end]

  return {
    connectionName: params.connectionName,
    rootConnectionName: params.rootConnectionName,
    traceThickness: params.traceThickness,
    viaDiameter: params.viaDiameter,
    route,
    vias:
      start.z === end.z
        ? []
        : [
            {
              x: start.x,
              y: start.y,
            },
          ],
  }
}

export const finalizeRoutesWithSameRootSharedJunctions = (params: {
  routes: HighDensityIntraNodeRoute[]
  originalNodeWithPortPoints: NodeWithPortPoints
  normalizedNodeWithPortPoints: NodeWithPortPoints
  removedConnectionNames: Set<string>
  traceThickness: number
  viaDiameter: number
}): HighDensityIntraNodeRoute[] => {
  const repairedRoutes = repairDisconnectedSameRootPortPoints(
    params.routes,
    params.normalizedNodeWithPortPoints,
  )
  const expandedRoutes = [...repairedRoutes]
  const routedConnectionNames = new Set(
    expandedRoutes.map((route) => route.connectionName),
  )

  for (const connectionName of params.removedConnectionNames) {
    if (routedConnectionNames.has(connectionName)) continue

    const points = getConnectionPortPoints(
      params.originalNodeWithPortPoints,
      connectionName,
    )
    if (points.length < 2) continue

    const route = buildDirectSameRootRoute({
      connectionName,
      rootConnectionName:
        params.originalNodeWithPortPoints.portPoints.find(
          (portPoint) => portPoint.connectionName === connectionName,
        )?.rootConnectionName ?? connectionName,
      points,
      traceThickness: params.traceThickness,
      viaDiameter: params.viaDiameter,
    })

    if (!route) continue
    expandedRoutes.push(route)
    routedConnectionNames.add(connectionName)
  }

  return repairDisconnectedSameRootPortPoints(
    expandedRoutes,
    params.originalNodeWithPortPoints,
  ).filter((route) => {
    const points = getConnectionPortPoints(
      params.originalNodeWithPortPoints,
      route.connectionName,
    )
    if (points.length < 2) return true
    return points.some((point) => routeTouchesConnectionPoint(route, point))
  })
}
