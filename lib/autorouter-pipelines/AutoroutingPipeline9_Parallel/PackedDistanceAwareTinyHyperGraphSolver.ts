// Native one-ended expansion order from tiny-hypergraph commit
// 474f5222e799b54348da41d96a0da0694509fab8. MIT license retained by the fork.
// Copyright (c) 2026 tscircuit. See tiny-hypergraph-fork/LICENSE.
import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import { TinyHyperGraphSolver, type TinyHyperGraphProblem, type TinyHyperGraphSolverOptions, type TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { PackedIndexedCandidateHeap } from "./PackedIndexedCandidateHeap"
import { TinyActiveIncidenceIndex } from "./TinyActiveIncidenceIndex"
import { TinyTriangularDistanceIndex } from "./TinyTriangularDistanceIndex"
import { TinyRegionCostMemo, type TinyRegionCostMethod } from "./TinyRegionCostMemo"

const nativeRegionCost = (TinyHyperGraphSolver.prototype as unknown as {
  computeRegionCostForRegion: TinyRegionCostMethod
}).computeRegionCostForRegion

export type PackedDistanceAwareTinyHyperGraphSolverOptions = TinyHyperGraphSolverOptions & {
  /** Diagnostic opt-in: full-dataset measurements favor direct distance math. */
  enableTriangularDistanceCache?: boolean
}

/** Keep native route policy while packing its directed-hop candidate frontier. */
export class PackedDistanceAwareTinyHyperGraphSolver extends DistanceAwareTinyHyperGraphSolver {
  private readonly regionPortOffsets: Int32Array
  private readonly regionPorts: Int32Array
  private readonly nextRegionByIncidence: Int32Array
  private readonly hopByIncidence: Float64Array
  private packedCandidateQueue?: PackedIndexedCandidateHeap
  private readonly activeIncidences: TinyActiveIncidenceIndex
  private activeSearchGeneration = 0
  private readonly distanceIndex?: TinyTriangularDistanceIndex
  readonly regionCostMemo?: TinyRegionCostMemo

  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem,
    options?: PackedDistanceAwareTinyHyperGraphSolverOptions) {
    super(topology, problem, options)
    this.regionPortOffsets = new Int32Array(topology.regionCount + 1)
    let count = 0
    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      const ports = topology.regionIncidentPorts[regionId]
      if (!ports) throw new Error(`Packed pathing region ${regionId} has no port incidence`)
      count += ports.length
      if (!Number.isSafeInteger(count) || count > 0x7fffffff) {
        throw new Error("Packed region incidence exceeds Int32 capacity")
      }
      this.regionPortOffsets[regionId + 1] = count
    }
    this.regionPorts = new Int32Array(count)
    this.nextRegionByIncidence = new Int32Array(count).fill(-1)
    this.hopByIncidence = new Float64Array(count)
    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      let position = this.regionPortOffsets[regionId]!
      for (const portId of topology.regionIncidentPorts[regionId]!) {
        if (!Number.isInteger(portId) || portId < 0 || portId >= topology.portCount) {
          throw new Error(`Packed pathing region ${regionId} has an invalid port`)
        }
        this.regionPorts[position] = portId
        const incidence = topology.incidentPortRegion[portId]
        if (!incidence) throw new Error(`Packed pathing port ${portId} has no region incidence`)
        const nextRegionId = incidence[0] === regionId ? incidence[1] : incidence[0]
        if (nextRegionId !== undefined) {
          this.nextRegionByIncidence[position] = nextRegionId
          this.hopByIncidence[position] = this.getHopId(portId, nextRegionId)
        }
        position++
      }
    }
    this.activeIncidences = new TinyActiveIncidenceIndex(
      this.regionPorts, this.hopByIncidence, this.nextRegionByIncidence, this.candidateHopCapacity,
    )
    this.distanceIndex = options?.enableTriangularDistanceCache === true
      ? TinyTriangularDistanceIndex.forTopology(topology) : undefined
    if (this.computeRegionCostForRegion === PackedDistanceAwareTinyHyperGraphSolver.prototype.computeRegionCostForRegion) {
      this.regionCostMemo = new TinyRegionCostMemo(this, nativeRegionCost.bind(this))
    }
  }

  protected override computeRegionCostForRegion(regionId: number, same: number,
    cross: number, changes: number, count: number): number {
    const currentNative = (TinyHyperGraphSolver.prototype as unknown as {
      computeRegionCostForRegion: TinyRegionCostMethod
    }).computeRegionCostForRegion
    // Constructors can call the virtual method before the memo exists. Custom
    // overrides calling super must retain their native callback path as well.
    if (!this.regionCostMemo || currentNative !== nativeRegionCost ||
      this.computeRegionCostForRegion !== PackedDistanceAwareTinyHyperGraphSolver.prototype.computeRegionCostForRegion) {
      return super.computeRegionCostForRegion(regionId, same, cross, changes, count)
    }
    return this.regionCostMemo.get(regionId, same, cross, changes, count)
  }

  override _setup(): void {
    super._setup()
    const queue = new PackedIndexedCandidateHeap(this.topology.regionCount, {
      hopCapacity: this.candidateHopCapacity,
      hopSlotStride: this.candidateHopSlotStride,
      firstRegionByPortId: this.candidateFirstRegionByPortId,
      secondRegionByPortId: this.candidateSecondRegionByPortId,
      incidentPortRegion: this.topology.incidentPortRegion,
    })
    this.packedCandidateQueue = queue
    this.activeSearchGeneration = 0
    this.state.candidateQueue = queue
  }

  override _step(): void {
    const { problem, topology, state } = this
    const queue = this.packedCandidateQueue
    if (!queue || state.candidateQueue !== queue) throw new Error("Packed pathing queue was replaced after setup")
    if (state.currentRouteId === undefined) {
      if (state.unroutedRoutes.length === 0) {
        this.onAllRoutesRouted()
        return
      }
      state.currentRouteId = state.unroutedRoutes.shift()
      state.currentRouteNetId = problem.routeNet[state.currentRouteId!]
      this.routeAttemptCountByRouteId[state.currentRouteId!] += 1
      this.resetCandidateBestCosts()
      const startingPortId = this.getRouteStartPortId(state.currentRouteId!)
      queue.clear()
      const startingNextRegionId = this.getStartingNextRegionId(state.currentRouteId!, startingPortId)
      if (startingNextRegionId === undefined) {
        this.failed = true
        this.error = `Start port ${startingPortId} has no incident regions`
        return
      }
      const startingHopId = this.getHopId(startingPortId, startingNextRegionId)
      this.setCandidateBestCost(startingHopId, 0)
      queue.queueValues(startingHopId, undefined, startingNextRegionId, startingPortId,
        0, 0, 0, undefined)
      state.goalPortId = this.getRouteEndPortId(state.currentRouteId!)
    }
    if (this.activeSearchGeneration !== queue.searchGeneration) {
      this.activeIncidences.beginSearch()
      this.activeSearchGeneration = queue.searchGeneration
    }
    const currentCandidate = queue.dequeue()
    if (!currentCandidate) {
      this.onOutOfCandidates()
      return
    }
    const currentCandidateHopId = currentCandidate.hopId ??
      this.getHopId(currentCandidate.portId, currentCandidate.nextRegionId)
    this.activeIncidences.closeHop(currentCandidateHopId, state.goalPortId)
    if (currentCandidate.g > this.getCandidateBestCost(currentCandidateHopId)) return
    if (this.isRegionReservedForDifferentNet(currentCandidate.nextRegionId)) return
    const sourceX = topology.portX[currentCandidate.portId]!
    const sourceY = topology.portY[currentCandidate.portId]!
    const distanceIndex = this.distanceIndex
    const sourceLocal = distanceIndex?.getSourceLocalIndex(currentCandidate.portId, currentCandidate.nextRegionId) ?? -1
    const sourceRevision = distanceIndex?.refreshPort(currentCandidate.portId, sourceX, sourceY) ?? 0
    const sourceWrap = distanceIndex?.wrapGeneration ?? 0
    const start = this.regionPortOffsets[currentCandidate.nextRegionId]!
    const end = this.regionPortOffsets[currentCandidate.nextRegionId + 1]!
    const firstWord = start >>> 5
    const finalWord = (end - 1) >>> 5
    for (let word = firstWord; word <= finalWord && start < end; word++) {
      let active = this.activeIncidences.getWord(word)
      if (word === firstWord) active &= 0xffffffff << (start & 31)
      if (word === finalWord && (end & 31) !== 0) active &= (1 << (end & 31)) - 1
      while (active !== 0) {
        const bit = active & -active
        active ^= bit
        const position = word * 32 + 31 - Math.clz32(bit)
        const neighborPortId = this.regionPorts[position]!
        // The goal check precedes ordinary section-mask/hop checks in the native
        // policy. Its final segment is scored by DistanceAware.onPathFound.
        if (neighborPortId === state.goalPortId) {
          const assignedNetId = state.portAssignment[neighborPortId]
          if (this.isPortReservedForDifferentNet(neighborPortId)) continue
          if (assignedNetId !== -1 && assignedNetId !== state.currentRouteNetId) continue
          this.onPathFound(currentCandidate)
          return
        }
        if (neighborPortId === currentCandidate.portId) continue
        if (problem.portSectionMask[neighborPortId] === 0) continue
        const nextRegionId = this.nextRegionByIncidence[position]!
        if (nextRegionId === -1) continue
        const candidateHopId = this.hopByIncidence[position]!
        const assignedNetId = state.portAssignment[neighborPortId]
        if (this.isPortReservedForDifferentNet(neighborPortId)) continue
        if (assignedNetId !== -1 && assignedNetId !== state.currentRouteNetId) continue
        if (this.isRegionReservedForDifferentNet(nextRegionId)) continue
        const previousBestCost = this.getCandidateBestCost(candidateHopId)
        if (currentCandidate.g >= previousBestCost) continue
        const lowerBoundWithoutDistance = currentCandidate.g +
          state.regionCongestionCost[currentCandidate.nextRegionId]! +
          (problem.portPenalty?.[neighborPortId] ?? 0)
        let knownSegmentDistance: number | undefined
        let lowerBoundCost = lowerBoundWithoutDistance
        if (this.ADD_SEGMENT_DISTANCE_TO_G) {
          const destinationX = topology.portX[neighborPortId]!
          const destinationY = topology.portY[neighborPortId]!
          if (distanceIndex && sourceLocal !== -1) {
            knownSegmentDistance = distanceIndex.getDistance(
              currentCandidate.nextRegionId, sourceLocal, currentCandidate.portId, sourceRevision,
              sourceWrap, sourceX, sourceY, position - start, neighborPortId, destinationX, destinationY,
            )
          } else {
            const dx = sourceX - destinationX
            const dy = sourceY - destinationY
            knownSegmentDistance = Math.sqrt(dx * dx + dy * dy)
          }
          lowerBoundCost += knownSegmentDistance * this.DISTANCE_TO_COST
        }
        if (lowerBoundCost >= previousBestCost) continue
        const g = this.computeG(currentCandidate, neighborPortId, previousBestCost, knownSegmentDistance)
        if (!Number.isFinite(g) || g >= previousBestCost) continue
        const h = this.computeH(neighborPortId)
        if (neighborPortId === state.goalPortId) {
          this.onPathFound({ hopId: candidateHopId, prevRegionId: currentCandidate.nextRegionId,
            nextRegionId, portId: neighborPortId, g, h, f: g + h, prevCandidate: currentCandidate })
          return
        }
        this.setCandidateBestCost(candidateHopId, g)
        queue.queueValues(candidateHopId, currentCandidate.nextRegionId, nextRegionId,
          neighborPortId, g, h, g + h, currentCandidate)
      }
    }
  }
}
