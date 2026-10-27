import { pointToSegmentDistance } from '@tscircuit/math-utils'
import { isPointInOrOnPolygon } from 'lib/utils/polygonContainment'
import type { HighDensityIntraNodeRoute } from 'lib/types/high-density-types'
import { hasViaObstacleCollision } from '../HyperHighDensitySolver/hasViaObstacleCollision'
import { areRoutesClearOfMandatoryPorts, areSingleTransitionPlanarRoutesClear, type SingleTransitionBoardContext } from './findSingleTransitionVia'
import { CompletedCopperWorldIndex, areRoutesClearOfCompletedCopper, type RoutedPeerWorldIndex } from './completedCopperWorldIndex'

type Point = { x: number; y: number; z: number }
export type PhysicalGridGuards = {
  minimumViaCenterDistance: number
  wireAllowed(a: Point, b: Point): boolean
  viaAllowed(point: Point, fromZ: number): boolean
}

/** Prepare the bounded raw context once, before the grid admits any copper. */
export const createPhysicalGridGuards = (params: {
  context: SingleTransitionBoardContext & { routedPeerWorldIndex?: RoutedPeerWorldIndex }
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  center: { x: number; y: number }
  connectionName: string
  rootConnectionName?: string
  traceWidth: number
  viaDiameter: number
}): PhysicalGridGuards => {
  const { center, traceWidth, viaDiameter } = params
  const scale = params.context.coordinateScale
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Invalid physical grid coordinate scale")
  const world = (p: { x: number; y: number }) => ({ x: center.x + (p.x - center.x) / scale, y: center.y + (p.y - center.y) / scale })
  const lo = world({ x: params.bounds.minX, y: params.bounds.minY })
  const hi = world({ x: params.bounds.maxX, y: params.bounds.maxY })
  const margin = Math.max(traceWidth / 2 + params.context.traceToPadClearance,
    traceWidth / 2 + (params.context.traceToHoleClearance ?? params.context.traceToPadClearance),
    viaDiameter / 2 + params.context.viaToPadClearance,
    viaDiameter / 2 + (params.context.boardGeometry?.minBoardEdgeClearance ?? 0))
  const obstacles = params.context.obstacles.filter((o) => {
    const angle = (o.ccwRotationDegrees ?? 0) * Math.PI / 180
    const rx = o.shape === "circle" ? o.width / 2 : (Math.abs(Math.cos(angle)) * o.width + Math.abs(Math.sin(angle)) * o.height) / 2
    const ry = o.shape === "circle" ? o.width / 2 : (Math.abs(Math.sin(angle)) * o.width + Math.abs(Math.cos(angle)) * o.height) / 2
    return o.center.x + rx >= lo.x - margin && o.center.x - rx <= hi.x + margin &&
      o.center.y + ry >= lo.y - margin && o.center.y - ry <= hi.y + margin
  })
  const context = { ...params.context, obstacles }
  const localPeers = new CompletedCopperWorldIndex({ layerCount: context.layerCount,
    allowBlindAndBuriedVias: context.allowBlindAndBuriedVias, traceClearance: context.traceToPadClearance,
    viaHoleDiameter: context.viaHoleDiameter, minViaHoleEdgeToViaHoleEdgeClearance: context.minViaHoleEdgeToViaHoleEdgeClearance })
  localPeers.addRoutes(context.routedPeerRoutes ?? [], { center, coordinateScale: scale })
  const makeRoute = (route: Point[], vias: { x: number; y: number }[]): HighDensityIntraNodeRoute => ({
    connectionName: params.connectionName, rootConnectionName: params.rootConnectionName,
    traceThickness: traceWidth, viaDiameter, route, vias,
  })
  const externalClear = (route: HighDensityIntraNodeRoute) =>
    areRoutesClearOfCompletedCopper({ routes: [route], routedPeerWorldIndex: localPeers,
      connMap: context.connMap, center, coordinateScale: scale }) && (!context.routedPeerWorldIndex ||
    areRoutesClearOfCompletedCopper({ routes: [route], routedPeerWorldIndex: context.routedPeerWorldIndex,
      connMap: context.connMap, center, coordinateScale: scale }))
  return {
    minimumViaCenterDistance: Math.max(viaDiameter + .1,
      (context.viaHoleDiameter ?? viaDiameter) + (context.minViaHoleEdgeToViaHoleEdgeClearance ?? .1)) * scale,
    wireAllowed(a, b) {
      const route = makeRoute([a, b], [])
      return areSingleTransitionPlanarRoutesClear({ routes: [route], context, center }) && externalClear(route)
    },
    viaAllowed(point, fromZ) {
      const route = makeRoute([{ ...point, z: fromZ }, point], [{ x: point.x, y: point.y }])
      if (hasViaObstacleCollision({ routes: [route], ...context, center, coordinateScale: scale }) ||
        !areRoutesClearOfMandatoryPorts({ routes: [route], context, center, traceThickness: traceWidth, viaDiameter }) || !externalClear(route)) return false
      const p = world(point), radius = viaDiameter / 2
      const minZ = context.allowBlindAndBuriedVias ? Math.min(fromZ, point.z) : 0
      const maxZ = context.allowBlindAndBuriedVias ? Math.max(fromZ, point.z) : context.layerCount - 1
      const board = context.boardGeometry
      if (board && (p.x < board.bounds.minX + radius + (board.minBoardEdgeClearance ?? 0) ||
        p.x > board.bounds.maxX - radius - (board.minBoardEdgeClearance ?? 0) ||
        p.y < board.bounds.minY + radius + (board.minBoardEdgeClearance ?? 0) ||
        p.y > board.bounds.maxY - radius - (board.minBoardEdgeClearance ?? 0))) return false
      if (board?.outline?.length) {
        if (!isPointInOrOnPolygon(p, board.outline)) return false
        for (let i = 0; i < board.outline.length; i++) if (pointToSegmentDistance(p, board.outline[i]!,
          board.outline[(i + 1) % board.outline.length]!) + 1e-9 < radius + (board.minBoardEdgeClearance ?? 0)) return false
      }
      return true
    },
  }
}
