import type { Candidate, TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { TinyBitsetIntersectionIndex } from "./TinyBitsetIntersectionIndex"

type RegionCost = (
  regionId: number, sameLayer: number, crossLayer: number,
  entryExitChanges: number, segmentCount: number,
) => number

/** Preserve core.computeG's arithmetic order, pruning, and topology angles. */
export class TinyBitsetCandidateScorer {
  private readonly index = new TinyBitsetIntersectionIndex()

  constructor(
    private readonly solver: TinyHyperGraphSolver,
    private readonly firstRegionByPortId: Int32Array,
    private readonly secondRegionByPortId: Int32Array,
    private readonly addSegmentDistance: () => boolean,
    private readonly regionCost: RegionCost,
  ) {}

  computeG(
    currentCandidate: Candidate,
    neighborPortId: number,
    maximumCost: number,
    knownSegmentDistance?: number,
  ): number {
    const { solver } = this
    const { state, topology } = solver
    const regionId = currentCandidate.nextRegionId
    const regionCache = state.regionIntersectionCaches[regionId]
    const regionCongestionCost = state.regionCongestionCost[regionId]!
    const neighborPortPenalty = solver.problem.portPenalty?.[neighborPortId] ?? 0
    let segmentDistanceCost = 0
    if (this.addSegmentDistance()) {
      let segmentDistance = knownSegmentDistance
      if (segmentDistance === undefined) {
        const dx = topology.portX[currentCandidate.portId]! - topology.portX[neighborPortId]!
        const dy = topology.portY[currentCandidate.portId]! - topology.portY[neighborPortId]!
        segmentDistance = Math.sqrt(dx * dx + dy * dy)
      }
      segmentDistanceCost = segmentDistance * solver.DISTANCE_TO_COST
    }
    const lowerBoundCost = currentCandidate.g + regionCongestionCost +
      neighborPortPenalty + segmentDistanceCost
    if (lowerBoundCost > maximumCost + 1e-9) return Number.POSITIVE_INFINITY

    let sameLayer = 0
    let crossLayer = 0
    const z1 = topology.portZ[currentCandidate.portId]
    const z2 = topology.portZ[neighborPortId]
    const entryExitChanges = z1 !== z2 ? 1 : 0
    if (regionCache.existingSegmentCount > 0) {
      const fromPortId = currentCandidate.portId
      const angle1 = this.firstRegionByPortId[fromPortId] === regionId ||
        this.secondRegionByPortId[fromPortId] !== regionId
        ? topology.portAngleForRegion1[fromPortId]
        : (topology.portAngleForRegion2?.[fromPortId] ?? topology.portAngleForRegion1[fromPortId])
      const angle2 = this.firstRegionByPortId[neighborPortId] === regionId ||
        this.secondRegionByPortId[neighborPortId] !== regionId
        ? topology.portAngleForRegion1[neighborPortId]
        : (topology.portAngleForRegion2?.[neighborPortId] ?? topology.portAngleForRegion1[neighborPortId])
      const lesserAngle = angle1 < angle2 ? angle1 : angle2
      const greaterAngle = angle1 < angle2 ? angle2 : angle1
      ;[sameLayer, crossLayer] = this.index.count(
        regionCache, state.currentRouteNetId!, lesserAngle, greaterAngle,
        (1 << z1) | (1 << z2),
      )
    }
    if (sameLayer > 0 && solver.isKnownSingleLayerRegion(regionId)) {
      return Number.POSITIVE_INFINITY
    }
    const newRegionCost = this.regionCost(
      regionId,
      regionCache.existingSameLayerIntersections + sameLayer,
      regionCache.existingCrossingLayerIntersections + crossLayer,
      regionCache.existingEntryExitLayerChanges + entryExitChanges,
      regionCache.existingSegmentCount + 1,
    ) - regionCache.existingRegionCost
    return currentCandidate.g + newRegionCost + regionCongestionCost +
      neighborPortPenalty + segmentDistanceCost
  }
}
