import { distance, pointToSegmentDistance } from "@tscircuit/math-utils"
import { SingleHighDensityRouteSolver } from "./SingleHighDensityRouteSolver"
import { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"

const FUTURE_CONNECTION_POINT_CACHE_SIZE = 1024

export class SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost extends SingleHighDensityRouteSolver {
  FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR = 2
  FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR = 1
  FUTURE_CONNECTION_PROXIMITY_VD = 10
  MISALIGNED_DIST_PENALTY_FACTOR = 5
  VIA_PENALTY_FACTOR_2 = 1
  FLIP_TRACE_ALIGNMENT_DIRECTION = false
  FUTURE_CONNECTION_VIA_TRACE_CLEARANCE = 0.1
  futureConnectionPoints: FutureConnectionPoint[]
  futureConnectionSegmentsCache: FutureConnectionSegment[] | null = null
  private closestFuturePointCache: Array<
    ClosestFuturePointCacheEntry | undefined
  > = []

  constructor(
    opts: ConstructorParameters<typeof SingleHighDensityRouteSolver>[0],
  ) {
    super({
      ...opts,
      nearbySegmentClearance:
        opts.nearbySegmentClearance ??
        (opts.traceThickness ?? 0.15) / 2 + (opts.obstacleMargin ?? 0.15),
    })
    for (const key in opts.hyperParameters) {
      // @ts-ignore
      this[key] = opts.hyperParameters[key]
    }

    // Ratio of available space determines via penalty
    const viasThatCanFitHorz = this.boundsSize.width / this.viaDiameter
    // Avoid division by zero when there are no routes
    const routeCount = Math.max(1, this.numRoutes)
    this.VIA_PENALTY_FACTOR =
      0.3 * (viasThatCanFitHorz / routeCount) * this.VIA_PENALTY_FACTOR_2
    this.futureConnectionPoints = this.futureConnections.flatMap(
      (connection) => connection.points,
    )
  }

  private getClosestFutureConnection(node: Node): ClosestFuturePointCacheEntry {
    const nodeKey = this.getNodeKey(node)
    const cacheIndex = nodeKey & (FUTURE_CONNECTION_POINT_CACHE_SIZE - 1)
    const cached = this.closestFuturePointCache[cacheIndex]
    if (
      cached?.nodeKey === nodeKey &&
      cached.nodeX === node.x &&
      cached.nodeY === node.y &&
      cached.nodeZ === node.z
    ) {
      return cached
    }

    let minDist = Infinity
    let closestPoint: FutureConnectionPoint | null = null
    let closestPointDistance = Infinity
    const viaPenaltyDistance = this.viaPenaltyDistance

    for (const point of this.futureConnectionPoints) {
      const dx = node.x - point.x
      const dy = node.y - point.y
      const pointDistance = Math.sqrt(dx * dx + dy * dy)
      const dist = pointDistance + (node.z !== point.z ? viaPenaltyDistance : 0)
      if (dist < minDist) {
        minDist = dist
        closestPoint = point
        closestPointDistance = pointDistance
      }
    }

    if (cached) {
      cached.nodeKey = nodeKey
      cached.nodeX = node.x
      cached.nodeY = node.y
      cached.nodeZ = node.z
      cached.point = closestPoint
      cached.distance = closestPointDistance
      return cached
    }

    const entry = {
      nodeKey,
      nodeX: node.x,
      nodeY: node.y,
      nodeZ: node.z,
      point: closestPoint,
      distance: closestPointDistance,
    }
    this.closestFuturePointCache[cacheIndex] = entry
    return entry
  }

  getClosestFutureConnectionPoint(node: Node) {
    return this.getClosestFutureConnection(node).point
  }

  getFutureConnectionSegments() {
    if (this.futureConnectionSegmentsCache) {
      return this.futureConnectionSegmentsCache
    }
    const segments: FutureConnectionSegment[] = []

    for (const futureConnection of this.futureConnections) {
      const isConnected =
        futureConnection.connectionName === this.connectionName ||
        (this.connMap?.areIdsConnected?.(
          this.connectionName,
          futureConnection.connectionName,
        ) ??
          false)
      if (isConnected) continue

      const [start, ...rest] = futureConnection.points
      if (!start) continue

      for (const end of rest) {
        if (
          Math.abs(start.x - end.x) < 1e-9 &&
          Math.abs(start.y - end.y) < 1e-9
        ) {
          continue
        }
        segments.push({
          connectionName: futureConnection.connectionName,
          start,
          end,
        })
      }
    }

    this.futureConnectionSegmentsCache = segments
    return segments
  }

  isViaTooCloseToFutureConnectionTrace(node: Node) {
    const minCenterlineDistance =
      this.viaDiameter / 2 +
      this.traceThickness / 2 +
      this.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE

    for (const segment of this.getFutureConnectionSegments()) {
      if (
        pointToSegmentDistance(node, segment.start, segment.end) <
        minCenterlineDistance
      ) {
        return true
      }
    }

    return false
  }

  override isNodeTooCloseToObstacle(
    node: Node,
    margin?: number,
    isVia?: boolean,
    planarObstacleQuery?: Parameters<
      SingleHighDensityRouteSolver["isNodeTooCloseToObstacle"]
    >[3],
  ) {
    if (
      super.isNodeTooCloseToObstacle(node, margin, isVia, planarObstacleQuery)
    ) {
      return true
    }

    if (isVia && this.isViaTooCloseToFutureConnectionTrace(node)) {
      return true
    }

    return false
  }

  /**
   * Rapidly approaches 0 as the goal distance approaches 0
   */
  diminishCloseToGoal(node: Node) {
    const goalDist = distance(node, this.B)
    return 1 - Math.exp((-goalDist / this.straightLineDistance) * 5)
  }

  getFutureConnectionPenalty(node: Node, isVia: boolean) {
    let futureConnectionPenalty = 0
    const closestFutureConnection = this.getClosestFutureConnection(node)
    const closestFuturePoint = closestFutureConnection.point
    const goalDist = distance(node, this.B)
    if (closestFuturePoint) {
      const distToFuturePoint = closestFutureConnection.distance
      if (goalDist <= distToFuturePoint) return 0
      const maxDist = this.viaDiameter * this.FUTURE_CONNECTION_PROXIMITY_VD
      const distRatio = distToFuturePoint / maxDist
      const maxPenalty = isVia
        ? this.straightLineDistance *
          this.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR
        : this.straightLineDistance *
          this.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR
      futureConnectionPenalty = maxPenalty * Math.exp(-distRatio * 5)
    }
    return futureConnectionPenalty
  }

  computeH(node: Node) {
    const goalDist = distance(node, this.B) ** 1.6
    const goalDistRatio = goalDist / this.straightLineDistance

    // Base cost from original function
    const baseCost =
      goalDist + (node.z !== this.B.z ? this.viaPenaltyDistance : 0)

    return (
      baseCost +
      this.getFutureConnectionPenalty(node, node.z !== node.parent?.z)
    )
  }

  computeG(node: Node) {
    const dx = Math.abs(node.x - node.parent!.x)
    const dy = Math.abs(node.y - node.parent!.y)
    const dist = Math.sqrt(dx ** 2 + dy ** 2)

    // Even layers (0, 2, ...) prefer horizontal, odd layers (1, 3, ...) prefer vertical
    const isEvenLayer = node.z % 2 === 0
    const misalignedDist = !this.FLIP_TRACE_ALIGNMENT_DIRECTION
      ? isEvenLayer
        ? dy
        : dx
      : isEvenLayer
        ? dx
        : dy

    // Base cost from original function
    const baseCost =
      (node.parent?.g ?? 0) +
      (node.z === node.parent?.z ? 0 : this.viaPenaltyDistance) +
      dist +
      misalignedDist * this.MISALIGNED_DIST_PENALTY_FACTOR

    return (
      baseCost +
      this.getFutureConnectionPenalty(node, node.z !== node.parent?.z)
    )
  }

  override setNodeCosts(node: Node) {
    const dx = Math.abs(node.x - node.parent!.x)
    const dy = Math.abs(node.y - node.parent!.y)
    const dist = Math.sqrt(dx ** 2 + dy ** 2)
    const isEvenLayer = node.z % 2 === 0
    const misalignedDist = !this.FLIP_TRACE_ALIGNMENT_DIRECTION
      ? isEvenLayer
        ? dy
        : dx
      : isEvenLayer
        ? dx
        : dy
    const baseG =
      (node.parent?.g ?? 0) +
      (node.z === node.parent?.z ? 0 : this.viaPenaltyDistance) +
      dist +
      misalignedDist * this.MISALIGNED_DIST_PENALTY_FACTOR

    const goalDist = distance(node, this.B) ** 1.6
    const baseH = goalDist + (node.z !== this.B.z ? this.viaPenaltyDistance : 0)
    const futureConnectionPenalty = this.getFutureConnectionPenalty(
      node,
      node.z !== node.parent?.z,
    )

    node.g = baseG + futureConnectionPenalty
    node.h = baseH + futureConnectionPenalty
    node.f = this.computeF(node.g, node.h)
  }
}

type FutureConnectionSegment = {
  connectionName: string
  start: { x: number; y: number; z: number }
  end: { x: number; y: number; z: number }
}

type FutureConnectionPoint = { x: number; y: number; z: number }

type ClosestFuturePointCacheEntry = {
  nodeKey: number
  nodeX: number
  nodeY: number
  nodeZ: number
  point: FutureConnectionPoint | null
  distance: number
}
