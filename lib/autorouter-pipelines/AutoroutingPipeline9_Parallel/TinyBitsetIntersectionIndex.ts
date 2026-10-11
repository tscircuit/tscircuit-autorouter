import { setNewIntersectionCounts, type MutableIntersectionCount } from "tiny-hypergraph/lib/countNewIntersections"
import type { DynamicAnglePairArrays } from "tiny-hypergraph/lib/types"

type EndpointPrefix = { before: number; through: number }
type RegionBitsetSnapshot = {
  angles: number[]
  endpointPrefixes: Int32Array
  prefixesByAngle: Map<number, EndpointPrefix>
  segmentMaskByNetId: Map<number, number>
  segmentMaskByLayerMask: Map<number, number>
}

const popcount32 = (value: number): number => {
  let bits = value >>> 0
  bits -= (bits >>> 1) & 0x55555555
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333)
  bits = (bits + (bits >>> 4)) & 0x0f0f0f0f
  return ((bits * 0x01010101) >>> 24)
}

/**
 * Region arrays are immutable snapshots in the base and selective-rerip Tiny
 * solvers: appending, ripping, and restoring replace the cache object. This
 * index must not be shared with solvers that mutate those arrays in place.
 */
export class TinyBitsetIntersectionIndex {
  private readonly snapshots = new WeakMap<DynamicAnglePairArrays, RegionBitsetSnapshot>()
  private readonly countScratch: MutableIntersectionCount = {
    netId: 0, lesserAngle: 0, greaterAngle: 0, layerMask: 0,
    entryExitLayerChanges: 0, sameLayerIntersectionCount: 0, crossingLayerIntersectionCount: 0,
  }

  constructor(private readonly minimumBitsetSegmentCount = 8) {}

  count(
    pairs: DynamicAnglePairArrays,
    newNet: number,
    lesserAngle: number,
    greaterAngle: number,
    layerMask: number,
  ): [number, number] {
    const scratch = this.countScratch
    scratch.netId = newNet
    scratch.lesserAngle = lesserAngle
    scratch.greaterAngle = greaterAngle
    scratch.layerMask = layerMask
    this.setCounts(pairs, scratch)
    return [scratch.sameLayerIntersectionCount, scratch.crossingLayerIntersectionCount]
  }

  setCounts(pairs: DynamicAnglePairArrays, result: MutableIntersectionCount): void {
    const { netId: newNet, lesserAngle, greaterAngle, layerMask } = result
    if (!(lesserAngle < greaterAngle) || pairs.netIds.length === 0) {
      result.sameLayerIntersectionCount = 0
      result.crossingLayerIntersectionCount = 0
      return
    }
    // Short arrays retain the native loop; one bit represents each larger segment.
    if (pairs.netIds.length < this.minimumBitsetSegmentCount || pairs.netIds.length > 32) {
      setNewIntersectionCounts(pairs, result)
      return
    }
    let snapshot = this.snapshots.get(pairs)
    if (!snapshot) {
      snapshot = this.createSnapshot(pairs)
      this.snapshots.set(pairs, snapshot)
    }
    const lowerPrefix = this.getEndpointPrefix(snapshot, lesserAngle)
    const upperPrefix = this.getEndpointPrefix(snapshot, greaterAngle)
    // XOR toggles each segment once per endpoint in the strictly open interval.
    const crossings = (upperPrefix.before ^ lowerPrefix.through) &
      ~(snapshot.segmentMaskByNetId.get(newNet) ?? 0)
    let layerOverlap = snapshot.segmentMaskByLayerMask.get(layerMask)
    if (layerOverlap === undefined) {
      layerOverlap = 0
      for (let i = 0; i < pairs.layerMasks.length; i++) {
        if ((layerMask & pairs.layerMasks[i]) !== 0) layerOverlap |= 1 << i
      }
      snapshot.segmentMaskByLayerMask.set(layerMask, layerOverlap)
    }
    result.sameLayerIntersectionCount = popcount32(crossings & layerOverlap)
    result.crossingLayerIntersectionCount = popcount32(crossings & ~layerOverlap)
  }

  private createSnapshot(pairs: DynamicAnglePairArrays): RegionBitsetSnapshot {
    const endpoints: Array<{ angle: number; bit: number }> = []
    const segmentMaskByNetId = new Map<number, number>()
    for (let i = 0; i < pairs.netIds.length; i++) {
      const bit = 1 << i
      endpoints.push({ angle: pairs.lesserAngles[i], bit })
      endpoints.push({ angle: pairs.greaterAngles[i], bit })
      segmentMaskByNetId.set(
        pairs.netIds[i], (segmentMaskByNetId.get(pairs.netIds[i]) ?? 0) | bit,
      )
    }
    endpoints.sort((a, b) => a.angle - b.angle)
    const angles = endpoints.map((endpoint) => endpoint.angle)
    const endpointPrefixes = new Int32Array(endpoints.length + 1)
    for (let i = 0; i < endpoints.length; i++) {
      endpointPrefixes[i + 1] = endpointPrefixes[i] ^ endpoints[i].bit
    }
    return {
      angles, endpointPrefixes, segmentMaskByNetId,
      prefixesByAngle: new Map(), segmentMaskByLayerMask: new Map(),
    }
  }

  private getEndpointPrefix(snapshot: RegionBitsetSnapshot, angle: number): EndpointPrefix {
    const cached = snapshot.prefixesByAngle.get(angle)
    if (cached) return cached
    const { angles, endpointPrefixes } = snapshot
    let low = 0
    let high = angles.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (angles[middle] < angle) low = middle + 1
      else high = middle
    }
    const before = endpointPrefixes[low]
    high = angles.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (angles[middle] <= angle) low = middle + 1
      else high = middle
    }
    const prefix = { before, through: endpointPrefixes[low] }
    snapshot.prefixesByAngle.set(angle, prefix)
    return prefix
  }
}
