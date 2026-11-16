import { TRACE_VIA_MARGIN } from "./computeRegionCost"
import {
  type Candidate,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "./core"
import { IndexedCandidateHeap } from "./indexed-candidate-heap"
import type { PortId, RouteId } from "./types"

type LayerTransitionRegion = {
  layerMask: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  minimumTransitionCost: number
  goalCost: number
}

/**
 * Adds geometric segment distance to the normal dynamic routing cost.
 *
 * Every segment, including the final segment into the goal, uses the same
 * g-cost calculation. The hop-keyed candidate frontier prevents a dominated
 * queued hop from being expanded later.
 */
export class DistanceAwareTinyHyperGraphSolver extends TinyHyperGraphSolver {
  private layerTransitionRegions?: LayerTransitionRegion[]
  private layerTransitionCostByPort?: Float64Array
  private layerTransitionGoalPortId = -1
  private lastLayerBoundSupported = true
  private readonly initialMinViaPadDiameter: number
  private readonly initialTraceDensityCostFactor: number
  private readonly initialDistanceToCost: number

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    this.ADD_SEGMENT_DISTANCE_TO_G = true
    this.initialMinViaPadDiameter = this.minViaPadDiameter
    this.initialTraceDensityCostFactor = this.TRACE_DENSITY_COST_FACTOR
    this.initialDistanceToCost = this.DISTANCE_TO_COST
    this.lastLayerBoundSupported =
      Number.isFinite(this.minViaPadDiameter) &&
      this.minViaPadDiameter >= 0 &&
      Number.isFinite(this.DISTANCE_TO_COST) &&
      this.DISTANCE_TO_COST >= 0 &&
      Number.isFinite(this.TRACE_DENSITY_COST_FACTOR) &&
      this.TRACE_DENSITY_COST_FACTOR >= 0 &&
      (problem.portPenalty?.every((penalty) => penalty >= 0) ?? true)
  }

  private prepareLayerTransitionRegions(): void {
    const { topology } = this
    const regions: LayerTransitionRegion[] = []
    this.layerTransitionRegions = regions
    // Native expansion can enter through a port's incidence list even when a
    // manually constructed region omits that port from its neighbor list.
    const incidentPortsByRegion = topology.regionIncidentPorts.map((ports) => [
      ...ports,
    ])
    for (let portId = 0; portId < topology.portCount; portId++) {
      for (const regionId of topology.incidentPortRegion[portId] ?? []) {
        const ports = incidentPortsByRegion[regionId]
        if (!ports) {
          this.lastLayerBoundSupported = false
          return
        }
        ports.push(portId)
      }
    }
    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      let layerMask = 0
      let minX = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      for (const portId of incidentPortsByRegion[regionId]) {
        const x = topology.portX[portId]
        const y = topology.portY[portId]
        const z = topology.portZ[portId]
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          !Number.isInteger(z) ||
          z < 0 ||
          z >= 32
        ) {
          this.lastLayerBoundSupported = false
          return
        }
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
        layerMask |= 1 << z
      }
      const area =
        topology.regionWidth[regionId] * topology.regionHeight[regionId]
      if (!(area > 0 && Number.isFinite(area))) {
        this.lastLayerBoundSupported = false
        return
      }
      if (layerMask === 0 || (layerMask & (layerMask - 1)) === 0) continue
      regions.push({
        layerMask,
        minX,
        maxX,
        minY,
        maxY,
        minimumTransitionCost:
          (1.2 * (this.minViaPadDiameter + TRACE_VIA_MARGIN) ** 2) / area,
        goalCost: 0,
      })
    }
  }

  private getLayerTransitionLowerBound(
    portId: PortId,
    goalPortId: PortId,
  ): number {
    if (!this.layerTransitionRegions) this.prepareLayerTransitionRegions()
    if (!this.lastLayerBoundSupported) return 0
    const regions = this.layerTransitionRegions!
    if (this.layerTransitionGoalPortId !== goalPortId) {
      const goalX = this.topology.portX[goalPortId]
      const goalY = this.topology.portY[goalPortId]
      const layerMask = 1 << this.topology.portZ[goalPortId]
      for (const region of regions) {
        if ((region.layerMask & layerMask) === 0) {
          region.goalCost = Number.POSITIVE_INFINITY
          continue
        }
        const dx = Math.max(0, region.minX - goalX, goalX - region.maxX)
        const dy = Math.max(0, region.minY - goalY, goalY - region.maxY)
        region.goalCost =
          Math.hypot(dx, dy) * this.DISTANCE_TO_COST +
          region.minimumTransitionCost
      }
      regions.sort((left, right) => left.goalCost - right.goalCost)
      this.layerTransitionCostByPort ??= new Float64Array(this.topology.portCount)
      this.layerTransitionCostByPort.fill(Number.NaN)
      this.layerTransitionGoalPortId = goalPortId
    }
    const cached = this.layerTransitionCostByPort![portId]
    if (!Number.isNaN(cached)) return cached
    const x = this.topology.portX[portId]
    const y = this.topology.portY[portId]
    let cost = Number.POSITIVE_INFINITY
    for (const region of regions) {
      // The remaining distance to this region is nonnegative. Later regions
      // cannot improve the bound once their goal-side cost reaches the best.
      if (region.goalCost >= cost) break
      const dx = Math.max(0, region.minX - x, x - region.maxX)
      const dy = Math.max(0, region.minY - y, y - region.maxY)
      cost = Math.min(
        cost,
        Math.hypot(dx, dy) * this.DISTANCE_TO_COST + region.goalCost,
      )
    }
    const lowerBound = Number.isFinite(cost) ? cost : 0
    this.layerTransitionCostByPort![portId] = lowerBound
    return lowerBound
  }

  protected override getRouteHeuristic(routeId: RouteId, portId: PortId): number {
    const heuristic = super.getRouteHeuristic(routeId, portId)
    if (
      !this.ADD_SEGMENT_DISTANCE_TO_G ||
      this.problemSetup.portHCostToEndOfRoute ||
      this.computeG !== super.computeG ||
      this.computeRegionCostForRegion !== super.computeRegionCostForRegion
    ) {
      return heuristic
    }
    // A changed region score may no longer match costs cached at commit time.
    if (
      this.minViaPadDiameter !== this.initialMinViaPadDiameter ||
      this.TRACE_DENSITY_COST_FACTOR !== this.initialTraceDensityCostFactor ||
      this.DISTANCE_TO_COST !== this.initialDistanceToCost ||
      this.RIP_CONGESTION_REGION_COST_FACTOR < 0
    ) {
      this.lastLayerBoundSupported = false
    }
    if (!this.lastLayerBoundSupported) return heuristic
    const goalPortId = this.getRouteEndPortId(routeId)
    if (this.topology.portZ[portId] === this.topology.portZ[goalPortId]) {
      return heuristic
    }
    // Every path must reach a region for its last hop onto the goal layer,
    // pay that transition, and cover the remaining distance to the goal.
    // Actual port bounds include duplicates outside nominal region dimensions.
    // Max preserves the existing XY bound without counting distance twice.
    return Math.max(
      heuristic,
      this.getLayerTransitionLowerBound(portId, goalPortId),
    )
  }

  override _setup(): void {
    super._setup()
    this.state.candidateQueue = new IndexedCandidateHeap(
      this.topology.regionCount,
      {
        hopCapacity: this.candidateHopCapacity,
        hopSlotStride: this.candidateHopSlotStride,
        firstRegionByPortId: this.candidateFirstRegionByPortId,
        secondRegionByPortId: this.candidateSecondRegionByPortId,
        incidentPortRegion: this.topology.incidentPortRegion,
      },
    )
  }

  override onPathFound(finalCandidate: Candidate): void {
    const goalPortId = this.state.goalPortId
    if (finalCandidate.portId === goalPortId) {
      super.onPathFound(finalCandidate)
      return
    }

    const g = this.computeG(finalCandidate, goalPortId)
    if (!Number.isFinite(g)) return

    const goalHopId = this.getHopId(goalPortId, finalCandidate.nextRegionId)
    if (g >= this.getCandidateBestCost(goalHopId)) return

    this.setCandidateBestCost(goalHopId, g)
    this.state.candidateQueue.queue({
      hopId: goalHopId,
      prevRegionId: finalCandidate.nextRegionId,
      nextRegionId: finalCandidate.nextRegionId,
      portId: goalPortId,
      g,
      h: 0,
      f: g,
      prevCandidate: finalCandidate,
    })
  }
}
