import type { TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { setNewIntersectionCounts, type MutableIntersectionCount } from "tiny-hypergraph/lib/countNewIntersections"
import type { DynamicAnglePairArrays } from "tiny-hypergraph/lib/types"

type TypedRegionAngleSnapshot = {
  regionId: number
  before: Int32Array
  through: Int32Array
  overlapByLayer: Int32Array
  segmentMaskByNetId: Map<number, number>
  lastNetId: number | undefined
  lastNetMask: number
}

type TwoWordRegionAngleSnapshot = {
  regionId: number
  before: Int32Array
  through: Int32Array
  overlapByLayer: Int32Array
  segmentMaskOffsetByNetId: Map<number, number>
  segmentMasksByNetId: Int32Array
  lastNetId: number | undefined
  lastNetLowerMask: number
  lastNetUpperMask: number
}

const MAX_TWO_WORD_SNAPSHOT_BYTES = 64 * 1024

const popcount32 = (value: number): number => {
  let bits = value >>> 0
  bits -= (bits >>> 1) & 0x55555555
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333)
  bits = (bits + (bits >>> 4)) & 0x0f0f0f0f
  return (bits * 0x01010101) >>> 24
}

/**
 * Topology/incidence angles are immutable during native Tiny routing. Region
 * occupancy arrays are immutable snapshots replaced on append, rip and restore.
 * This index relies on those same contracts as the constructor's hop tables.
 */
export class TinyTypedAnglePrefixIntersectionIndex {
  private readonly snapshots = new WeakMap<DynamicAnglePairArrays, TypedRegionAngleSnapshot>()
  private readonly twoWordSnapshots = new WeakMap<DynamicAnglePairArrays, TwoWordRegionAngleSnapshot>()
  private readonly anglesByRegion: Float64Array[]
  private readonly firstLocalIndexByPortId: Int32Array
  private readonly secondLocalIndexByPortId: Int32Array
  collectDiagnostics = false
  readonly diagnostics = { snapshotBuilds: 0, indexedCalls: 0, nativeCalls: 0 }

  constructor(
    topology: TinyHyperGraphTopology,
    private readonly firstRegionByPortId: Int32Array,
    private readonly secondRegionByPortId: Int32Array,
    private readonly minimumSegmentCount = 8,
  ) {
    this.firstLocalIndexByPortId = new Int32Array(topology.portCount).fill(-1)
    this.secondLocalIndexByPortId = new Int32Array(topology.portCount).fill(-1)
    this.anglesByRegion = topology.regionIncidentPorts.map((ports, regionId) => {
      const angles = new Float64Array(ports.length)
      for (let localIndex = 0; localIndex < ports.length; localIndex++) {
        const portId = ports[localIndex]!
        const first = firstRegionByPortId[portId] === regionId
        const second = !first && secondRegionByPortId[portId] === regionId
        const angle = first || !second ? topology.portAngleForRegion1[portId]
          : (topology.portAngleForRegion2?.[portId] ?? topology.portAngleForRegion1[portId])
        // Missing static angles retain native undefined-comparison semantics.
        // Third-plus incidences are handled by the native query path as well.
        if (!Number.isFinite(angle)) { angles[localIndex] = Number.NaN; continue }
        angles[localIndex] = angle!
        if (first) this.firstLocalIndexByPortId[portId] = localIndex
        else if (second) this.secondLocalIndexByPortId[portId] = localIndex
      }
      return angles
    })
  }

  setCounts(
    pairs: DynamicAnglePairArrays, result: MutableIntersectionCount,
    regionId: number, lesserPortId: number, greaterPortId: number, z1: number, z2: number,
  ): void {
    const count = pairs.netIds.length
    const lesserIndex = this.firstRegionByPortId[lesserPortId] === regionId
      ? this.firstLocalIndexByPortId[lesserPortId]
      : this.secondRegionByPortId[lesserPortId] === regionId
        ? this.secondLocalIndexByPortId[lesserPortId] : -1
    const greaterIndex = this.firstRegionByPortId[greaterPortId] === regionId
      ? this.firstLocalIndexByPortId[greaterPortId]
      : this.secondRegionByPortId[greaterPortId] === regionId
        ? this.secondLocalIndexByPortId[greaterPortId] : -1
    const angles = this.anglesByRegion[regionId]
    if (count < this.minimumSegmentCount || count > 64 ||
      !(lesserIndex! >= 0) || !(greaterIndex! >= 0) ||
      angles?.[lesserIndex!] !== result.lesserAngle || angles?.[greaterIndex!] !== result.greaterAngle ||
      result.layerMask !== ((1 << z1) | (1 << z2)) ||
      pairs.lesserAngles.length !== count || pairs.greaterAngles.length !== count ||
      pairs.layerMasks.length !== count ||
      (count > 32 && (!angles ||
        (4 * angles.length + 64 + 2 * count) * 4 > MAX_TWO_WORD_SNAPSHOT_BYTES))) {
      if (this.collectDiagnostics) this.diagnostics.nativeCalls++
      setNewIntersectionCounts(pairs, result)
      return
    }
    if (!(result.lesserAngle < result.greaterAngle)) {
      result.sameLayerIntersectionCount = 0
      result.crossingLayerIntersectionCount = 0
      return
    }
    if (count > 32) {
      this.setTwoWordCounts(pairs, result, regionId, lesserIndex!, greaterIndex!, z1, z2)
      return
    }
    let snapshot = this.snapshots.get(pairs)
    if (!snapshot || snapshot.regionId !== regionId) {
      snapshot = this.createSnapshot(pairs, regionId)
      this.snapshots.set(pairs, snapshot)
      if (this.collectDiagnostics) this.diagnostics.snapshotBuilds++
    }
    if (snapshot.lastNetId !== result.netId) {
      snapshot.lastNetId = result.netId
      snapshot.lastNetMask = snapshot.segmentMaskByNetId.get(result.netId) ?? 0
    }
    const crossings = (snapshot.before[greaterIndex!]! ^ snapshot.through[lesserIndex!]!) &
      ~snapshot.lastNetMask
    const layerOverlap = snapshot.overlapByLayer[z1 & 31]! | snapshot.overlapByLayer[z2 & 31]!
    result.sameLayerIntersectionCount = popcount32(crossings & layerOverlap)
    result.crossingLayerIntersectionCount = popcount32(crossings & ~layerOverlap)
    if (this.collectDiagnostics) this.diagnostics.indexedCalls++
  }

  private setTwoWordCounts(
    pairs: DynamicAnglePairArrays, result: MutableIntersectionCount,
    regionId: number, lesserIndex: number, greaterIndex: number, z1: number, z2: number,
  ): void {
    let snapshot = this.twoWordSnapshots.get(pairs)
    if (!snapshot || snapshot.regionId !== regionId) {
      snapshot = this.createTwoWordSnapshot(pairs, regionId)
      this.twoWordSnapshots.set(pairs, snapshot)
      if (this.collectDiagnostics) this.diagnostics.snapshotBuilds++
    }
    if (snapshot.lastNetId !== result.netId) {
      snapshot.lastNetId = result.netId
      const netOffset = snapshot.segmentMaskOffsetByNetId.get(result.netId)
      snapshot.lastNetLowerMask = netOffset === undefined ? 0 : snapshot.segmentMasksByNetId[netOffset]!
      snapshot.lastNetUpperMask = netOffset === undefined ? 0 : snapshot.segmentMasksByNetId[netOffset + 1]!
    }
    const lowerOffset = lesserIndex * 2
    const upperOffset = greaterIndex * 2
    const layer1Offset = (z1 & 31) * 2
    const layer2Offset = (z2 & 31) * 2
    const lowerCrossings = (snapshot.before[upperOffset]! ^ snapshot.through[lowerOffset]!) &
      ~snapshot.lastNetLowerMask
    const upperCrossings = (snapshot.before[upperOffset + 1]! ^ snapshot.through[lowerOffset + 1]!) &
      ~snapshot.lastNetUpperMask
    const lowerOverlap = snapshot.overlapByLayer[layer1Offset]! | snapshot.overlapByLayer[layer2Offset]!
    const upperOverlap = snapshot.overlapByLayer[layer1Offset + 1]! | snapshot.overlapByLayer[layer2Offset + 1]!
    result.sameLayerIntersectionCount = popcount32(lowerCrossings & lowerOverlap) +
      popcount32(upperCrossings & upperOverlap)
    result.crossingLayerIntersectionCount = popcount32(lowerCrossings & ~lowerOverlap) +
      popcount32(upperCrossings & ~upperOverlap)
    if (this.collectDiagnostics) this.diagnostics.indexedCalls++
  }

  private createTwoWordSnapshot(pairs: DynamicAnglePairArrays, regionId: number): TwoWordRegionAngleSnapshot {
    const angles = this.anglesByRegion[regionId]
    if (!angles) throw new Error(`Typed angle-prefix region ${regionId} has no static incidence`)
    const before = new Int32Array(angles.length * 2)
    const through = new Int32Array(angles.length * 2)
    const overlapByLayer = new Int32Array(64)
    const segmentMaskOffsetByNetId = new Map<number, number>()
    const segmentMasksByNetId = new Int32Array(pairs.netIds.length * 2)
    for (let segment = 0; segment < pairs.netIds.length; segment++) {
      const word = segment >>> 5
      const bit = 1 << (segment & 31)
      const lower = pairs.lesserAngles[segment]!
      const upper = pairs.greaterAngles[segment]!
      for (let incidence = 0; incidence < angles.length; incidence++) {
        const angle = angles[incidence]!
        const offset = incidence * 2 + word
        if (lower < angle) before[offset] ^= bit
        if (upper < angle) before[offset] ^= bit
        if (lower <= angle) through[offset] ^= bit
        if (upper <= angle) through[offset] ^= bit
      }
      const netId = pairs.netIds[segment]!
      let netOffset = segmentMaskOffsetByNetId.get(netId)
      if (netOffset === undefined) {
        netOffset = segmentMaskOffsetByNetId.size * 2
        segmentMaskOffsetByNetId.set(netId, netOffset)
      }
      segmentMasksByNetId[netOffset + word] |= bit
      let layers = pairs.layerMasks[segment]! >>> 0
      while (layers !== 0) {
        const layer = 31 - Math.clz32(layers & -layers)
        overlapByLayer[layer * 2 + word] |= bit
        layers = (layers & (layers - 1)) >>> 0
      }
    }
    return { regionId, before, through, overlapByLayer, segmentMaskOffsetByNetId,
      segmentMasksByNetId, lastNetId: undefined, lastNetLowerMask: 0, lastNetUpperMask: 0 }
  }

  private createSnapshot(pairs: DynamicAnglePairArrays, regionId: number): TypedRegionAngleSnapshot {
    const angles = this.anglesByRegion[regionId]
    if (!angles) throw new Error(`Typed angle-prefix region ${regionId} has no static incidence`)
    const before = new Int32Array(angles.length)
    const through = new Int32Array(angles.length)
    const overlapByLayer = new Int32Array(32)
    const segmentMaskByNetId = new Map<number, number>()
    for (let segment = 0; segment < pairs.netIds.length; segment++) {
      const bit = 1 << segment
      const lower = pairs.lesserAngles[segment]!
      const upper = pairs.greaterAngles[segment]!
      for (let incidence = 0; incidence < angles.length; incidence++) {
        const angle = angles[incidence]!
        if (lower < angle) before[incidence] ^= bit
        if (upper < angle) before[incidence] ^= bit
        if (lower <= angle) through[incidence] ^= bit
        if (upper <= angle) through[incidence] ^= bit
      }
      const netId = pairs.netIds[segment]!
      segmentMaskByNetId.set(netId, (segmentMaskByNetId.get(netId) ?? 0) | bit)
      let layers = pairs.layerMasks[segment]! >>> 0
      while (layers !== 0) {
        const layer = 31 - Math.clz32(layers & -layers)
        overlapByLayer[layer] |= bit
        layers = (layers & (layers - 1)) >>> 0
      }
    }
    return { regionId, before, through, overlapByLayer, segmentMaskByNetId,
      lastNetId: undefined, lastNetMask: 0 }
  }
}
