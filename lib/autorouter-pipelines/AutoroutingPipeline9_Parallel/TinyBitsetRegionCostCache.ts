import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import type { RegionIntersectionCache } from "tiny-hypergraph/lib/types"

export type TinyBitsetRegionCost = (
  regionId: number, sameLayer: number, crossLayer: number,
  entryExitChanges: number, segmentCount: number,
) => number

type RegionCostSnapshot = {
  regionId: number
  width: number
  height: number
  availableLayerMask: number
  minViaPadDiameter: number
  densityFactor: number
  sameLayer: number
  crossLayer: number
  entryExitChanges: number
  segmentCount: number
  pairCount: number
  costs: Map<number, number>
}

export type TinyBitsetRegionCostDiagnostics = {
  hits: number
  misses: number
  snapshots: number
  capacityMisses: number
}

/** Memoize only exact count tuples for an immutable region occupancy snapshot. */
export class TinyBitsetRegionCostCache {
  private readonly snapshots = new WeakMap<RegionIntersectionCache, RegionCostSnapshot>()
  collectDiagnostics = false
  readonly diagnostics: TinyBitsetRegionCostDiagnostics = {
    hits: 0, misses: 0, snapshots: 0, capacityMisses: 0,
  }

  constructor(
    private readonly solver: TinyHyperGraphSolver,
    private readonly regionCost: TinyBitsetRegionCost,
  ) {}

  get(
    regionId: number,
    cache: RegionIntersectionCache,
    newSameLayer: number,
    newCrossLayer: number,
    newEntryExitChanges: number,
  ): number {
    const pairCount = cache.netIds.length
    // At most 32 crossings makes this integer tuple encoding injective and small.
    if (pairCount > 32) {
      if (this.collectDiagnostics) this.diagnostics.capacityMisses++
      return this.regionCost(
        regionId, cache.existingSameLayerIntersections + newSameLayer,
        cache.existingCrossingLayerIntersections + newCrossLayer,
        cache.existingEntryExitLayerChanges + newEntryExitChanges,
        cache.existingSegmentCount + 1,
      )
    }
    const { solver } = this
    const width = solver.topology.regionWidth[regionId]
    const height = solver.topology.regionHeight[regionId]
    const availableLayerMask = solver.topology.regionAvailableZMask?.[regionId] ?? 0
    let snapshot = this.snapshots.get(cache)
    if (!snapshot || snapshot.regionId !== regionId ||
      !Object.is(snapshot.width, width) || !Object.is(snapshot.height, height) ||
      snapshot.availableLayerMask !== availableLayerMask ||
      !Object.is(snapshot.minViaPadDiameter, solver.minViaPadDiameter) ||
      !Object.is(snapshot.densityFactor, solver.TRACE_DENSITY_COST_FACTOR) ||
      snapshot.sameLayer !== cache.existingSameLayerIntersections ||
      snapshot.crossLayer !== cache.existingCrossingLayerIntersections ||
      snapshot.entryExitChanges !== cache.existingEntryExitLayerChanges ||
      snapshot.segmentCount !== cache.existingSegmentCount || snapshot.pairCount !== pairCount) {
      snapshot = {
        regionId, width, height, availableLayerMask,
        minViaPadDiameter: solver.minViaPadDiameter,
        densityFactor: solver.TRACE_DENSITY_COST_FACTOR,
        sameLayer: cache.existingSameLayerIntersections,
        crossLayer: cache.existingCrossingLayerIntersections,
        entryExitChanges: cache.existingEntryExitLayerChanges,
        segmentCount: cache.existingSegmentCount, pairCount, costs: new Map(),
      }
      this.snapshots.set(cache, snapshot)
      if (this.collectDiagnostics) this.diagnostics.snapshots++
    }
    // Counts are integers in [0,pairCount], and the final coordinate is 0 or 1.
    const key = (newSameLayer * (pairCount + 1) + newCrossLayer) * 2 + newEntryExitChanges
    const cached = snapshot.costs.get(key)
    if (cached !== undefined) {
      if (this.collectDiagnostics) this.diagnostics.hits++
      return cached
    }
    const cost = this.regionCost(
      regionId, cache.existingSameLayerIntersections + newSameLayer,
      cache.existingCrossingLayerIntersections + newCrossLayer,
      cache.existingEntryExitLayerChanges + newEntryExitChanges,
      cache.existingSegmentCount + 1,
    )
    snapshot.costs.set(key, cost)
    if (this.collectDiagnostics) this.diagnostics.misses++
    return cost
  }
}
