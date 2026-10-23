import type { DynamicAnglePairArrays } from "tiny-hypergraph/lib/types"

type EndpointEvent = { angle: number; segment: number }

export type TinyCrossingIndexDiagnostics = {
  crossingIndexQueryDiagnosticsEnabled: number
  crossingIndexInstalledSolvers: number
  crossingIndexNativeScorerSolvers: number
  crossingIndexBuilds: number
  crossingIndexBuildSegments: number
  crossingIndexPrefixWords: number
  crossingIndexQueries: number
  crossingIndexWordQueries: number
  crossingIndexReplacedSegmentComparisons: number
  crossingIndexAllocatedBytes: number
  crossingIndexMaximumTableBytes: number
  crossingIndexMaximumSolverTableBytes: number
}

export function createTinyCrossingIndexDiagnostics(collectQueryWork = false): TinyCrossingIndexDiagnostics {
  return {
    crossingIndexQueryDiagnosticsEnabled: Number(collectQueryWork),
    crossingIndexInstalledSolvers: 0,
    crossingIndexNativeScorerSolvers: 0,
    crossingIndexBuilds: 0,
    crossingIndexBuildSegments: 0,
    crossingIndexPrefixWords: 0,
    crossingIndexQueries: 0,
    crossingIndexWordQueries: 0,
    crossingIndexReplacedSegmentComparisons: 0,
    crossingIndexAllocatedBytes: 0,
    crossingIndexMaximumTableBytes: 0,
    crossingIndexMaximumSolverTableBytes: 0,
  }
}

function populationCount32(input: number): number {
  let value = input >>> 0
  value -= (value >>> 1) & 0x55555555
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333)
  const nibbles = (value + (value >>> 4)) & 0x0f0f0f0f
  return (Math.imul(nibbles, 0x01010101) >>> 24)
}

/**
 * Exact native strict-interval crossing counts for one committed cache version.
 * Native append/replay/reset/restore replace its arrays; this index never owns
 * or changes those arrays. Prefix parity records one bit per existing segment.
 */
export class TinyRegionCrossingIndex {
  readonly wordCount: number
  readonly byteLength: number
  readonly netIds: Int32Array
  readonly lesserAngles: Int32Array
  readonly greaterAngles: Int32Array
  readonly layerMasks: Int32Array
  private readonly prefixLess: Uint32Array
  private readonly prefixInclusive: Uint32Array
  private readonly layerBits: Uint32Array
  private readonly netBits = new Map<number, Uint32Array>()
  private lastNetId: number | undefined
  private lastNetBits: Uint32Array | undefined
  private readonly collectQueryWork: boolean
  sameLayerIntersectionCount = 0
  crossingLayerIntersectionCount = 0

  constructor(
    source: DynamicAnglePairArrays,
    private readonly queryAngles: Int32Array,
    private readonly queryLayers: Int32Array,
    private readonly diagnostics: TinyCrossingIndexDiagnostics,
  ) {
    this.netIds = source.netIds
    this.collectQueryWork = diagnostics.crossingIndexQueryDiagnosticsEnabled === 1
    this.lesserAngles = source.lesserAngles
    this.greaterAngles = source.greaterAngles
    this.layerMasks = source.layerMasks
    const segmentCount = source.netIds.length
    if (
      source.lesserAngles.length !== segmentCount ||
      source.greaterAngles.length !== segmentCount ||
      source.layerMasks.length !== segmentCount ||
      queryAngles.length !== queryLayers.length
    ) {
      throw new Error("Tiny crossing index requires matching native arrays")
    }
    this.wordCount = Math.ceil(segmentCount / 32)
    this.prefixLess = new Uint32Array(queryAngles.length * this.wordCount)
    this.prefixInclusive = new Uint32Array(this.prefixLess.length)
    this.layerBits = new Uint32Array(32 * this.wordCount)
    const events: EndpointEvent[] = []
    for (let segment = 0; segment < segmentCount; segment++) {
      events.push({ angle: source.lesserAngles[segment]!, segment })
      events.push({ angle: source.greaterAngles[segment]!, segment })
      const word = segment >>> 5
      const bit = 1 << (segment & 31)
      const net = source.netIds[segment]!
      let netBits = this.netBits.get(net)
      if (!netBits) {
        netBits = new Uint32Array(this.wordCount)
        this.netBits.set(net, netBits)
      }
      netBits[word] = netBits[word]! | bit
      for (let z = 0; z < 32; z++) {
        if ((source.layerMasks[segment]! & (1 << z)) !== 0) {
          const offset = z * this.wordCount + word
          this.layerBits[offset] = this.layerBits[offset]! | bit
        }
      }
    }
    events.sort((left, right) => left.angle - right.angle)
    const slots = Array.from(queryAngles.keys()).sort(
      (left, right) => queryAngles[left]! - queryAngles[right]!,
    )
    const activeBits = new Uint32Array(this.wordCount)
    let eventIndex = 0
    for (let queryIndex = 0; queryIndex < slots.length;) {
      const slot = slots[queryIndex]!
      const angle = queryAngles[slot]!
      let groupEnd = queryIndex + 1
      while (groupEnd < slots.length && queryAngles[slots[groupEnd]!] === angle) groupEnd++
      while (eventIndex < events.length && events[eventIndex]!.angle < angle) {
        const segment = events[eventIndex++]!.segment
        activeBits[segment >>> 5] = activeBits[segment >>> 5]! ^ (1 << (segment & 31))
      }
      for (let index = queryIndex; index < groupEnd; index++) this.prefixLess.set(activeBits, slots[index]! * this.wordCount)
      while (eventIndex < events.length && events[eventIndex]!.angle === angle) {
        const segment = events[eventIndex++]!.segment
        activeBits[segment >>> 5] = activeBits[segment >>> 5]! ^ (1 << (segment & 31))
      }
      for (let index = queryIndex; index < groupEnd; index++) this.prefixInclusive.set(activeBits, slots[index]! * this.wordCount)
      queryIndex = groupEnd
    }
    this.byteLength = this.prefixLess.byteLength + this.prefixInclusive.byteLength + this.layerBits.byteLength + this.netBits.size * this.wordCount * 4
    diagnostics.crossingIndexBuilds++
    diagnostics.crossingIndexBuildSegments += segmentCount
    diagnostics.crossingIndexPrefixWords += this.prefixLess.length + this.prefixInclusive.length
    diagnostics.crossingIndexAllocatedBytes += this.byteLength
    diagnostics.crossingIndexMaximumTableBytes = Math.max(diagnostics.crossingIndexMaximumTableBytes, this.byteLength)
  }

  matchesSource(source: DynamicAnglePairArrays): boolean {
    return this.netIds === source.netIds &&
      this.lesserAngles === source.lesserAngles &&
      this.greaterAngles === source.greaterAngles &&
      this.layerMasks === source.layerMasks
  }

  count(fromSlot: number, toSlot: number, netId: number): void {
    if (this.collectQueryWork) {
      this.diagnostics.crossingIndexQueries++
      this.diagnostics.crossingIndexReplacedSegmentComparisons += this.netIds.length
    }
    const fromAngle = this.queryAngles[fromSlot]!
    const toAngle = this.queryAngles[toSlot]!
    // Equal endpoints describe the native empty strict interval. Taking XOR
    // without this guard would incorrectly include events at that angle.
    if (fromAngle === toAngle) {
      this.sameLayerIntersectionCount = 0
      this.crossingLayerIntersectionCount = 0
      return
    }
    const lowSlot = fromAngle < toAngle ? fromSlot : toSlot
    const highSlot = fromAngle < toAngle ? toSlot : fromSlot
    if (netId !== this.lastNetId) {
      this.lastNetId = netId
      this.lastNetBits = this.netBits.get(netId)
    }
    const fromLayerOffset = (this.queryLayers[fromSlot]! & 31) * this.wordCount
    const toLayerOffset = (this.queryLayers[toSlot]! & 31) * this.wordCount
    const highOffset = highSlot * this.wordCount
    const lowOffset = lowSlot * this.wordCount
    let same = 0
    let crossing = 0
    for (let word = 0; word < this.wordCount; word++) {
      const inside = (this.prefixLess[highOffset + word]! ^ this.prefixInclusive[lowOffset + word]!) & ~(this.lastNetBits?.[word] ?? 0)
      const sameLayer = this.layerBits[fromLayerOffset + word]! | this.layerBits[toLayerOffset + word]!
      same += populationCount32(inside & sameLayer)
      crossing += populationCount32(inside & ~sameLayer)
    }
    if (this.collectQueryWork) this.diagnostics.crossingIndexWordQueries += this.wordCount
    this.sameLayerIntersectionCount = same
    this.crossingLayerIntersectionCount = crossing
  }
}
