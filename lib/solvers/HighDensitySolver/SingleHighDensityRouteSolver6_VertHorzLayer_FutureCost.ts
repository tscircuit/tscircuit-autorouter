import { distance, pointToSegmentDistance } from "@tscircuit/math-utils"
import { SingleHighDensityRouteSolver } from "./SingleHighDensityRouteSolver"
import { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"

const CLOSEST_FUTURE_POINT_CACHE_SLOTS = 256
const FUTURE_VIA_CACHE_SLOTS = 1024

export class SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost extends SingleHighDensityRouteSolver {
  FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR = 2
  FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR = 1
  FUTURE_CONNECTION_PROXIMITY_VD = 10
  MISALIGNED_DIST_PENALTY_FACTOR = 5
  VIA_PENALTY_FACTOR_2 = 1
  FLIP_TRACE_ALIGNMENT_DIRECTION = false
  FUTURE_CONNECTION_VIA_TRACE_CLEARANCE = 0.1
  futureConnectionPoints: Array<{ x: number; y: number; z: number }>
  futureConnectionSegmentsCache: FutureConnectionSegment[] | null = null
  private readonly closestFuturePointCacheCoordinates = new Float64Array(
    CLOSEST_FUTURE_POINT_CACHE_SLOTS * 4,
  )
  private readonly closestFuturePointCacheIndices = new Int32Array(
    CLOSEST_FUTURE_POINT_CACHE_SLOTS,
  ).fill(-2)
  private cachedFutureConnectionPoints?: typeof this.futureConnectionPoints
  private cachedFutureConnectionPointCount = 0
  private cachedFutureConnections?: typeof this.futureConnections
  private cachedFutureConnectionCount = 0
  private readonly futureViaCacheCoordinates = new Float64Array(
    FUTURE_VIA_CACHE_SLOTS * 2,
  )
  private readonly futureViaCacheStates = new Uint8Array(FUTURE_VIA_CACHE_SLOTS)
  private cachedFutureViaMinCenterlineDistance: number | undefined
  private cachedFutureViaSegmentsRef: FutureConnectionSegment[] | null = null

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

  getClosestFutureConnectionPoint(node: Node) {
    if (
      this.cachedFutureConnectionPoints !== this.futureConnectionPoints ||
      this.cachedFutureConnectionPointCount !==
        this.futureConnectionPoints.length
    ) {
      this.closestFuturePointCacheIndices.fill(-2)
      this.cachedFutureConnectionPoints = this.futureConnectionPoints
      this.cachedFutureConnectionPointCount = this.futureConnectionPoints.length
    }
    const pointKey = this.getNodeKey(node)
    const cacheSlot = Number.isSafeInteger(pointKey)
      ? Math.abs(pointKey % CLOSEST_FUTURE_POINT_CACHE_SLOTS)
      : -1
    const coordinateIndex = cacheSlot * 4
    const viaPenaltyDistance = this.viaPenaltyDistance
    const cachedPointIndex = this.closestFuturePointCacheIndices[cacheSlot]
    // Rounded grid keys can alias coordinates or layers outside the grid.
    // Verify the exact query and layer penalty before reusing a selection.
    if (
      cacheSlot >= 0 &&
      cachedPointIndex >= -1 &&
      this.closestFuturePointCacheCoordinates[coordinateIndex] === node.x &&
      this.closestFuturePointCacheCoordinates[coordinateIndex + 1] === node.y &&
      this.closestFuturePointCacheCoordinates[coordinateIndex + 2] === node.z &&
      this.closestFuturePointCacheCoordinates[coordinateIndex + 3] ===
        viaPenaltyDistance
    ) {
      return cachedPointIndex === -1
        ? null
        : this.futureConnectionPoints[cachedPointIndex]
    }
    let minDist = Infinity
    let closestPoint = null
    let closestPointIndex = -1
    let pointIndex = 0

    for (const point of this.futureConnectionPoints) {
      const dist =
        distance(node, point) + (node.z !== point.z ? viaPenaltyDistance : 0)
      if (dist < minDist) {
        minDist = dist
        closestPoint = point
        closestPointIndex = pointIndex
      }
      pointIndex++
    }

    // A fixed workspace avoids retaining every explored coordinate in large
    // portfolio searches. Colliding slots simply perform the original scan.
    if (cacheSlot >= 0) {
      this.closestFuturePointCacheCoordinates[coordinateIndex] = node.x
      this.closestFuturePointCacheCoordinates[coordinateIndex + 1] = node.y
      this.closestFuturePointCacheCoordinates[coordinateIndex + 2] = node.z
      this.closestFuturePointCacheCoordinates[coordinateIndex + 3] =
        viaPenaltyDistance
      this.closestFuturePointCacheIndices[cacheSlot] = closestPointIndex
    }
    return closestPoint
  }

  getFutureConnectionSegments(): FutureConnectionSegment[] {
    if (
      this.futureConnectionSegmentsCache &&
      this.cachedFutureConnections === this.futureConnections &&
      this.cachedFutureConnectionCount === this.futureConnections.length
    ) {
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
          minX: Math.min(start.x, end.x),
          maxX: Math.max(start.x, end.x),
          minY: Math.min(start.y, end.y),
          maxY: Math.max(start.y, end.y),
        })
      }
    }

    this.cachedFutureConnections = this.futureConnections
    this.cachedFutureConnectionCount = this.futureConnections.length
    this.futureConnectionSegmentsCache = segments
    return segments
  }

  isViaTooCloseToFutureConnectionTrace(node: Node): boolean {
    const minCenterlineDistance =
      this.viaDiameter / 2 +
      this.traceThickness / 2 +
      this.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE
    if (!(minCenterlineDistance > 0)) return false

    const segments = this.getFutureConnectionSegments()
    if (segments.length === 0) return false

    let cacheSlot = -1
    if (this.gridWidth !== undefined) {
      if (
        this.cachedFutureViaMinCenterlineDistance !== minCenterlineDistance ||
        this.cachedFutureViaSegmentsRef !== segments
      ) {
        this.futureViaCacheStates.fill(0)
        this.cachedFutureViaMinCenterlineDistance = minCenterlineDistance
        this.cachedFutureViaSegmentsRef = segments
      }
      const xIndex = Math.round(node.x / this.cellStep) - this.gridMinXIndex
      const yIndex = Math.round(node.y / this.cellStep) - this.gridMinYIndex
      const columnKey = yIndex * this.gridWidth + xIndex
      if (Number.isSafeInteger(columnKey)) {
        cacheSlot = Math.abs(columnKey % FUTURE_VIA_CACHE_SLOTS)
        const coordinateOffset = cacheSlot * 2
        const cachedState = this.futureViaCacheStates[cacheSlot]
        if (
          cachedState !== 0 &&
          this.futureViaCacheCoordinates[coordinateOffset] === node.x &&
          this.futureViaCacheCoordinates[coordinateOffset + 1] === node.y
        ) {
          return cachedState === 2
        }
      }
    }

    for (const segment of segments) {
      if (
        node.x + minCenterlineDistance < segment.minX ||
        node.y + minCenterlineDistance < segment.minY ||
        node.x - minCenterlineDistance > segment.maxX ||
        node.y - minCenterlineDistance > segment.maxY
      ) {
        continue
      }
      if (
        pointToSegmentDistance(node, segment.start, segment.end) <
        minCenterlineDistance
      ) {
        if (cacheSlot >= 0) {
          const coordinateOffset = cacheSlot * 2
          this.futureViaCacheCoordinates[coordinateOffset] = node.x
          this.futureViaCacheCoordinates[coordinateOffset + 1] = node.y
          this.futureViaCacheStates[cacheSlot] = 2
        }
        return true
      }
    }

    if (cacheSlot >= 0) {
      const coordinateOffset = cacheSlot * 2
      this.futureViaCacheCoordinates[coordinateOffset] = node.x
      this.futureViaCacheCoordinates[coordinateOffset + 1] = node.y
      this.futureViaCacheStates[cacheSlot] = 1
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

  getFutureConnectionPenalty(
    node: Node,
    isVia: boolean,
    precomputedGoalDist?: number,
  ): number {
    let futureConnectionPenalty = 0
    const closestFuturePoint = this.getClosestFutureConnectionPoint(node)
    if (closestFuturePoint) {
      const goalDist = precomputedGoalDist ?? distance(node, this.B)
      const distToFuturePoint = distance(node, closestFuturePoint)
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
    const rawGoalDist = distance(node, this.B)
    const goalDist = rawGoalDist ** 1.6

    // Base cost from original function
    const baseCost =
      goalDist + (node.z !== this.B.z ? this.viaPenaltyDistance : 0)

    return (
      baseCost +
      this.getFutureConnectionPenalty(
        node,
        node.z !== node.parent?.z,
        rawGoalDist,
      )
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
    const viaPenalty = this.viaPenaltyDistance
    const baseG =
      (node.parent?.g ?? 0) +
      (node.z === node.parent?.z ? 0 : viaPenalty) +
      dist +
      misalignedDist * this.MISALIGNED_DIST_PENALTY_FACTOR

    const rawGoalDist = distance(node, this.B)
    const goalDist = rawGoalDist ** 1.6
    const baseH = goalDist + (node.z !== this.B.z ? viaPenalty : 0)
    const futureConnectionPenalty = this.getFutureConnectionPenalty(
      node,
      node.z !== node.parent?.z,
      rawGoalDist,
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
  minX: number
  maxX: number
  minY: number
  maxY: number
}
