import { distance, pointToSegmentDistance } from "@tscircuit/math-utils"
import { SingleHighDensityRouteSolver } from "./SingleHighDensityRouteSolver"
import { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"

type NodeCostTerms = {
  x: number
  y: number
  z: number
  goalDistancePower: number
  planarFuturePenalty: number | undefined
  viaFuturePenalty: number | undefined
}

type NodeCostParameters = {
  goalX: number
  goalY: number
  viaDiameter: number
  futureProximity: number
  futureTracePenaltyFactor: number
  futureViaPenaltyFactor: number
  straightLineDistance: number
  viaPenaltyDistance: number
  futureConnectionPoints: Array<{ x: number; y: number; z: number }>
}

const MAX_DENSE_COST_CACHE_SLOTS = 65_536

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
  private nodeCostParameters: NodeCostParameters | undefined
  private nodeCostTermsByGridKey = new Map<number, NodeCostTerms>()
  private denseNodeCostTerms:
    | Array<NodeCostTerms | undefined>
    | null
    | undefined

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
    let minDist = Infinity
    let closestPoint = null

    for (const point of this.futureConnectionPoints) {
      const dist =
        distance(node, point) +
        (node.z !== point.z ? this.viaPenaltyDistance : 0)
      if (dist < minDist) {
        minDist = dist
        closestPoint = point
      }
    }

    return closestPoint
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
    const closestFuturePoint = this.getClosestFutureConnectionPoint(node)
    const goalDist = distance(node, this.B)
    if (closestFuturePoint) {
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

  private invalidateChangedNodeCostParameters(): void {
    const previous = this.nodeCostParameters
    const viaPenaltyDistance = this.viaPenaltyDistance
    if (
      previous &&
      Object.is(previous.goalX, this.B.x) &&
      Object.is(previous.goalY, this.B.y) &&
      Object.is(previous.viaDiameter, this.viaDiameter) &&
      Object.is(
        previous.futureProximity,
        this.FUTURE_CONNECTION_PROXIMITY_VD,
      ) &&
      Object.is(
        previous.futureTracePenaltyFactor,
        this.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR,
      ) &&
      Object.is(
        previous.futureViaPenaltyFactor,
        this.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR,
      ) &&
      Object.is(previous.straightLineDistance, this.straightLineDistance) &&
      Object.is(previous.viaPenaltyDistance, viaPenaltyDistance) &&
      previous.futureConnectionPoints === this.futureConnectionPoints
    ) {
      return
    }

    // Point geometry stays fixed during a search. Replace the array when
    // changing future points; scalar routing parameters can change in place.
    this.nodeCostTermsByGridKey.clear()
    this.denseNodeCostTerms?.fill(undefined)
    if (!previous) {
      this.nodeCostParameters = {
        goalX: this.B.x,
        goalY: this.B.y,
        viaDiameter: this.viaDiameter,
        futureProximity: this.FUTURE_CONNECTION_PROXIMITY_VD,
        futureTracePenaltyFactor:
          this.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR,
        futureViaPenaltyFactor: this.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR,
        straightLineDistance: this.straightLineDistance,
        viaPenaltyDistance,
        futureConnectionPoints: this.futureConnectionPoints,
      }
      return
    }
    previous.goalX = this.B.x
    previous.goalY = this.B.y
    previous.viaDiameter = this.viaDiameter
    previous.futureProximity = this.FUTURE_CONNECTION_PROXIMITY_VD
    previous.futureTracePenaltyFactor =
      this.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR
    previous.futureViaPenaltyFactor =
      this.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR
    previous.straightLineDistance = this.straightLineDistance
    previous.viaPenaltyDistance = viaPenaltyDistance
    previous.futureConnectionPoints = this.futureConnectionPoints
  }

  private initializeDenseNodeCostTerms(): void {
    this.denseNodeCostTerms = null
    if (this.getNodeKey !== SingleHighDensityRouteSolver.prototype.getNodeKey)
      return
    let maxZ = Math.max(this.layerCount - 1, this.A.z, this.B.z)
    for (const z of this.availableZ) maxZ = Math.max(maxZ, z)
    const cellCount = this.gridWidth * this.gridHeight * (maxZ + 1)
    // Allocate only when costs are first needed, with bounded slot storage.
    // Custom keys and grids above this limit continue to use the sparse Map.
    if (
      Number.isSafeInteger(cellCount) &&
      cellCount > 0 &&
      cellCount <= MAX_DENSE_COST_CACHE_SLOTS
    ) {
      this.denseNodeCostTerms = new Array<NodeCostTerms | undefined>(cellCount)
    }
  }

  override setNodeCosts(node: Node): void {
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

    this.invalidateChangedNodeCostParameters()
    const gridKey = this.getNodeKey(node)
    if (this.denseNodeCostTerms === undefined) {
      this.initializeDenseNodeCostTerms()
    }
    const denseCache = this.denseNodeCostTerms
    const useDenseCache =
      denseCache &&
      this.getNodeKey === SingleHighDensityRouteSolver.prototype.getNodeKey &&
      Number.isInteger(gridKey) &&
      gridKey >= 0 &&
      gridKey < denseCache.length
    let costTerms = useDenseCache
      ? denseCache[gridKey]
      : this.nodeCostTermsByGridKey.get(gridKey)
    // Exact starts, clamped boundary points and accumulated floating-point
    // steps can share a grid key without sharing coordinates. Only reuse the
    // coordinate-dependent terms when all three coordinates match exactly.
    if (
      !costTerms ||
      costTerms.x !== node.x ||
      costTerms.y !== node.y ||
      costTerms.z !== node.z
    ) {
      costTerms = {
        x: node.x,
        y: node.y,
        z: node.z,
        goalDistancePower: distance(node, this.B) ** 1.6,
        planarFuturePenalty: undefined,
        viaFuturePenalty: undefined,
      }
      if (useDenseCache) denseCache[gridKey] = costTerms
      else this.nodeCostTermsByGridKey.set(gridKey, costTerms)
    }
    const baseH =
      costTerms.goalDistancePower +
      (node.z !== this.B.z ? this.viaPenaltyDistance : 0)
    const isVia = node.z !== node.parent?.z
    const defaultCosts =
      SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.prototype
    const canMemoizeFuturePenalty =
      this.getFutureConnectionPenalty ===
        defaultCosts.getFutureConnectionPenalty &&
      this.getClosestFutureConnectionPoint ===
        defaultCosts.getClosestFutureConnectionPoint
    let futureConnectionPenalty = canMemoizeFuturePenalty
      ? isVia
        ? costTerms.viaFuturePenalty
        : costTerms.planarFuturePenalty
      : undefined
    if (futureConnectionPenalty === undefined) {
      futureConnectionPenalty = this.getFutureConnectionPenalty(node, isVia)
      // Custom hooks can depend on the parent or other mutable search state.
      if (canMemoizeFuturePenalty) {
        if (isVia) costTerms.viaFuturePenalty = futureConnectionPenalty
        else costTerms.planarFuturePenalty = futureConnectionPenalty
      }
    }
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
