import type { RegionIntersectionCache } from "tiny-hypergraph/lib/types"
import type { RoutingSnapshot } from "./RouteProposalSolver"
import { copyReadonlyArray } from "./packedRoutingInput"

export type PackedRoutingSnapshot = {
  wave: number
  portAssignment: Int32Array
  regionCongestionCost: Float64Array
  regionIds: Int32Array
  offsets: Int32Array
  metadata: Float64Array
  netIds: Int32Array
  lesserAngles: Int32Array
  greaterAngles: Int32Array
  layerMasks: Int32Array
}

/** Copy the frozen wave once, rather than cloning thousands of cache objects per job. */
export function packRoutingSnapshot(snapshot: RoutingSnapshot, wave: number): PackedRoutingSnapshot {
  const rows = snapshot.populatedCaches
  const offsets = new Int32Array(rows.length + 1)
  const regionIds = new Int32Array(rows.length)
  const metadata = new Float64Array(rows.length * 5)
  for (let i = 0; i < rows.length; i++) {
    const [regionId, cache] = rows[i]!
    regionIds[i] = regionId
    offsets[i + 1] = offsets[i]! + cache.netIds.length
    metadata.set([cache.existingSameLayerIntersections, cache.existingCrossingLayerIntersections,
      cache.existingEntryExitLayerChanges, cache.existingSegmentCount, cache.existingRegionCost], i * 5)
  }
  const size = offsets[rows.length]!
  const netIds = new Int32Array(size)
  const lesserAngles = new Int32Array(size)
  const greaterAngles = new Int32Array(size)
  const layerMasks = new Int32Array(size)
  for (let i = 0; i < rows.length; i++) {
    const cache = rows[i]![1]
    netIds.set(cache.netIds, offsets[i]!)
    lesserAngles.set(cache.lesserAngles, offsets[i]!)
    greaterAngles.set(cache.greaterAngles, offsets[i]!)
    layerMasks.set(cache.layerMasks, offsets[i]!)
  }
  return {wave, portAssignment: copyReadonlyArray(snapshot.portAssignment),
    regionCongestionCost: copyReadonlyArray(snapshot.regionCongestionCost),
    regionIds: copyReadonlyArray(regionIds), offsets: copyReadonlyArray(offsets),
    metadata: copyReadonlyArray(metadata), netIds: copyReadonlyArray(netIds),
    lesserAngles: copyReadonlyArray(lesserAngles), greaterAngles: copyReadonlyArray(greaterAngles),
    layerMasks: copyReadonlyArray(layerMasks)}
}

export function unpackRoutingSnapshot(snapshot: PackedRoutingSnapshot): RoutingSnapshot {
  const populatedCaches: Array<[number, RegionIntersectionCache]> = []
  for (let i = 0; i < snapshot.regionIds.length; i++) {
    const start = snapshot.offsets[i]!
    const end = snapshot.offsets[i + 1]!
    populatedCaches.push([snapshot.regionIds[i]!, {
      netIds: snapshot.netIds.subarray(start, end),
      lesserAngles: snapshot.lesserAngles.subarray(start, end),
      greaterAngles: snapshot.greaterAngles.subarray(start, end),
      layerMasks: snapshot.layerMasks.subarray(start, end),
      existingSameLayerIntersections: snapshot.metadata[i * 5]!,
      existingCrossingLayerIntersections: snapshot.metadata[i * 5 + 1]!,
      existingEntryExitLayerChanges: snapshot.metadata[i * 5 + 2]!,
      existingSegmentCount: snapshot.metadata[i * 5 + 3]!,
      existingRegionCost: snapshot.metadata[i * 5 + 4]!,
    }])
  }
  return {portAssignment: snapshot.portAssignment, regionCongestionCost: snapshot.regionCongestionCost, populatedCaches}
}
