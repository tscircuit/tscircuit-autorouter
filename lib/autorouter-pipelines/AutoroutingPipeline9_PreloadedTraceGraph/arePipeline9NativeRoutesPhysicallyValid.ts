import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import {
  getPipeline9PhysicalObstacleOwner,
  getPipeline9PhysicalRouteOwner,
  type Pipeline9PhysicalOwnership,
} from "./getPipeline9PhysicalOwnership"
import {
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9RouteCopperGeometry,
} from "./pipeline9FixedRouteCopper"

type NativePhysicalValidationParams = {
  routes: HighDensityRoute[]
  immutableRoutes?: HighDensityRoute[]
  connMap: ConnectivityMap
  physicalOwnership?: Pipeline9PhysicalOwnership
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  traceClearance: number
  viaHoleDiameter: number
  minViaHoleEdgeToViaHoleEdgeClearance: number
  boardObstacles: Obstacle[]
  viaToPadClearance: number
  traceToPadClearance?: number
  traceToHoleClearance?: number
  routeDimensionsByConnectionName?: Readonly<Record<string, {
    traceThickness: number
    viaDiameter: number
  }>>
}

const getRouteOwner = (
  route: HighDensityRoute,
  connMap: ConnectivityMap,
): string => {
  const indexedOwner = connMap.getNetConnectedToId(route.connectionName)
  if (indexedOwner !== undefined) return `registered:${indexedOwner}`
  const root = route.rootConnectionName
  // A canonical root is already a net key, not another member ID to resolve.
  if (root !== undefined) {
    if (connMap.netMap[root]) return `registered:${root}`
    const rootOwner = connMap.getNetConnectedToId(root)
    if (rootOwner !== undefined) return `registered:${rootOwner}`
  }
  return `literal:${route.connectionName}`
}

const getSegmentToObstacleDistance = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  obstacle: Obstacle,
): number => {
  if (obstacle.shape === "circle") {
    return Math.max(0,
      minimumDistanceBetweenSegments(start, end, obstacle.center, obstacle.center) - obstacle.width / 2,
    )
  }
  const radians = (-(obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const localStart = {
    x: (start.x - obstacle.center.x) * cos - (start.y - obstacle.center.y) * sin,
    y: (start.x - obstacle.center.x) * sin + (start.y - obstacle.center.y) * cos,
  }
  const localEnd = {
    x: (end.x - obstacle.center.x) * cos - (end.y - obstacle.center.y) * sin,
    y: (end.x - obstacle.center.x) * sin + (end.y - obstacle.center.y) * cos,
  }
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2
  if ([localStart, localEnd].some((point) =>
    Math.abs(point.x) <= halfWidth && Math.abs(point.y) <= halfHeight,
  )) return 0
  const corners = [
    { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight },
  ]
  return Math.min(...corners.map((corner, index) =>
    minimumDistanceBetweenSegments(localStart, localEnd, corner, corners[(index + 1) % corners.length]!),
  ))
}

/** Validate manufactured copper in world coordinates before promoting a native candidate. */
export const arePipeline9NativeRoutesPhysicallyValid = (
  params: NativePhysicalValidationParams,
): boolean => {
  const { connMap, layerCount, allowBlindAndBuriedVias } = params
  const routes = [...params.routes, ...(params.immutableRoutes ?? [])].map((route) => {
    const dimensions = params.routeDimensionsByConnectionName?.[route.connectionName]
    return dimensions ? {
      ...route,
      traceThickness: Math.max(route.traceThickness, dimensions.traceThickness),
      viaDiameter: Math.max(route.viaDiameter, dimensions.viaDiameter),
      route: route.route.map((point) => ({
        ...point,
        traceThickness: Math.max(point.traceThickness ?? route.traceThickness, dimensions.traceThickness),
      })),
    } : route
  })
  const owners = routes.map((route) => params.physicalOwnership
    ? getPipeline9PhysicalRouteOwner(params.physicalOwnership, route)
    : getRouteOwner(route, connMap))
  const geometry = routes.map((route) =>
    getPipeline9RouteCopperGeometry(route, { layerCount, allowBlindAndBuriedVias }),
  )
  const minimumDrillDistance =
    params.viaHoleDiameter + params.minViaHoleEdgeToViaHoleEdgeClearance
  for (let left = 0; left < params.routes.length; left++) {
    const leftRoute = routes[left]!
    const leftVias = geometry[left]!.viaSpans
    for (let right = left; right < routes.length; right++) {
      const sameOwner = owners[left] !== undefined && owners[left] === owners[right]
      const rightVias = geometry[right]!.viaSpans
      for (let a = 0; a < leftVias.length; a++) {
        for (let b = right === left ? a + 1 : 0; b < rightVias.length; b++) {
          const first = leftVias[a]!
          const second = rightVias[b]!
          if (first.minZ > second.maxZ || second.minZ > first.maxZ) continue
          const distance = Math.hypot(
            first.center.x - second.center.x,
            first.center.y - second.center.y,
          )
          if (
            distance === 0 && sameOwner &&
            first.minZ === second.minZ && first.maxZ === second.maxZ &&
            first.diameter === second.diameter
          ) continue
          if (distance < minimumDrillDistance) return false
        }
      }
      if (
        right !== left &&
        !sameOwner &&
        doPipeline9RoutesHaveCopperConflict({
          left: leftRoute,
          right: routes[right]!,
          clearance: params.traceClearance,
          layerCount,
          allowBlindAndBuriedVias,
        })
      ) {
        return false
      }
    }
    const wires = geometry[left]!.wireSegments
    if (wires.length === 0 && leftVias.length === 0) continue
    const padding = Math.max(
      params.traceToPadClearance ?? params.traceClearance,
      params.traceToHoleClearance ?? 0.2,
      params.viaToPadClearance,
    ) + Math.max(
      ...wires.map((wire) => wire.width / 2),
      ...leftVias.map((via) => via.diameter / 2),
    )
    const minX = Math.min(...leftRoute.route.map((point) => point.x)) - padding
    const maxX = Math.max(...leftRoute.route.map((point) => point.x)) + padding
    const minY = Math.min(...leftRoute.route.map((point) => point.y)) - padding
    const maxY = Math.max(...leftRoute.route.map((point) => point.y)) + padding
    for (const obstacle of params.boardObstacles) {
        const radius = Math.hypot(obstacle.width, obstacle.height) / 2
        if (obstacle.center.x + radius < minX || obstacle.center.x - radius > maxX ||
          obstacle.center.y + radius < minY || obstacle.center.y - radius > maxY) continue
        const connected = !obstacle.isNonPlatedHole && (params.physicalOwnership
          ? owners[left] !== undefined && owners[left] === getPipeline9PhysicalObstacleOwner(params.physicalOwnership, obstacle)
          : obstacle.connectedTo.some((id) => {
          const indexedOwner = connMap.getNetConnectedToId(id)
          if (indexedOwner !== undefined) return owners[left] === `registered:${indexedOwner}`
          return connMap.netMap[id] !== undefined
            ? owners[left] === `registered:${id}`
            : owners[left] === `literal:${id}`
        }))
        if (connected) continue
        const layers =
          obstacle.__zLayers ??
          obstacle.zLayers ??
          obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
        for (const wire of wires) {
          if (!obstacle.isNonPlatedHole && !layers.includes(wire.z)) continue
          const clearance = obstacle.isNonPlatedHole
            ? params.traceToHoleClearance ?? 0.2
            : params.traceToPadClearance ?? params.traceClearance
          if (getSegmentToObstacleDistance(wire.start, wire.end, obstacle) < wire.width / 2 + clearance) {
            return false
          }
        }
        for (const via of leftVias) {
        if (!obstacle.isNonPlatedHole && !layers.some((z) => z >= via.minZ && z <= via.maxZ)) continue
        if (
          getSegmentToObstacleDistance(via.center, via.center, obstacle) <
          via.diameter / 2 + params.viaToPadClearance
        ) {
          return false
        }
        }
      }
  }
  return true
}
