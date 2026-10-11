import type { TinyHyperGraphProblem, TinyHyperGraphSolver, TinyHyperGraphSolverOptions, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"

export type NegotiatedPathSegment = { regionId: number; fromPortId: number; toPortId: number }
export type NegotiatedRoutePlan = {
  routeId: number
  activeStartPortId: number
  activeEndPortId: number
  forcedStartRegionId: number
  forcedEndRegionId: number
  rippedSegmentCount: number
  retainedSegmentCount: number
}
export type NegotiatedPathingGraph = { topology: TinyHyperGraphTopology; problem: TinyHyperGraphProblem }
export type NegotiatedOccupancySnapshot = {
  portAssignment: Int32Array
  regionCongestionCost: Float64Array
  regionOffsets: Uint32Array
  netIds: Int32Array
  lesserAngles: Int32Array
  greaterAngles: Int32Array
  layerMasks: Int32Array
  regionMetrics: Float64Array
}
export type NegotiatedPathingRouteJob = {
  kind: "pathingNegotiatedRoute"
  graphId: number
  graph?: NegotiatedPathingGraph
  snapshot: NegotiatedOccupancySnapshot
  routeId: number
  routePlan?: NegotiatedRoutePlan
  options: TinyHyperGraphSolverOptions
  mode: "cost-aware" | "greedy"
  /** Shared remaining work tickets for this whole candidate, including retries. */
  expansionTickets: Int32Array
}
export type NegotiatedPathingRouteResult = {
  kind: "pathingNegotiatedRoute"
  routeId: number
  status: "solved"
  segments: NegotiatedPathSegment[]
  expansions: number
} | {
  kind: "pathingNegotiatedRoute"
  routeId: number
  status: "exhausted" | "budget"
  expansions: number
}

/** A batch shares immutable occupancy arrays rather than cloning them four times. */
export function createNegotiatedOccupancySnapshot(solver: TinyHyperGraphSolver): NegotiatedOccupancySnapshot {
  const { state, topology } = solver
  const portAssignment = new Int32Array(new SharedArrayBuffer(state.portAssignment.byteLength))
  portAssignment.set(state.portAssignment)
  const regionCongestionCost = new Float64Array(new SharedArrayBuffer(state.regionCongestionCost.byteLength))
  regionCongestionCost.set(state.regionCongestionCost)
  const regionOffsets = new Uint32Array(new SharedArrayBuffer((topology.regionCount + 1) * 4))
  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    const cache = state.regionIntersectionCaches[regionId]
    if (!cache || cache.netIds.length !== cache.existingSegmentCount ||
        cache.lesserAngles.length !== cache.netIds.length || cache.greaterAngles.length !== cache.netIds.length ||
        cache.layerMasks.length !== cache.netIds.length) throw new Error(`Negotiated pathing found invalid occupancy for region ${regionId}`)
    regionOffsets[regionId + 1] = regionOffsets[regionId]! + cache.netIds.length
  }
  const segmentCount = regionOffsets[topology.regionCount]!
  const netIds = new Int32Array(new SharedArrayBuffer(segmentCount * 4))
  const lesserAngles = new Int32Array(new SharedArrayBuffer(segmentCount * 4))
  const greaterAngles = new Int32Array(new SharedArrayBuffer(segmentCount * 4))
  const layerMasks = new Int32Array(new SharedArrayBuffer(segmentCount * 4))
  const regionMetrics = new Float64Array(new SharedArrayBuffer(topology.regionCount * 4 * 8))
  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    const cache = state.regionIntersectionCaches[regionId]!
    const offset = regionOffsets[regionId]!
    netIds.set(cache.netIds, offset)
    lesserAngles.set(cache.lesserAngles, offset)
    greaterAngles.set(cache.greaterAngles, offset)
    layerMasks.set(cache.layerMasks, offset)
    regionMetrics.set([cache.existingSameLayerIntersections, cache.existingCrossingLayerIntersections,
      cache.existingEntryExitLayerChanges, cache.existingRegionCost], regionId * 4)
  }
  return { portAssignment, regionCongestionCost, regionOffsets, netIds, lesserAngles, greaterAngles,
    layerMasks, regionMetrics }
}
