import type { TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"

const MAX_DISTANCE_INDEX_BYTES = 64 * 1024 * 1024
const distanceIndexes = new WeakMap<TinyHyperGraphTopology, TinyTriangularDistanceIndex>()

/**
 * Exact planar distances; coordinate revisions invalidate affected pairs lazily.
 * Incidence/port IDs remain immutable, matching the native constructor hop tables.
 * XY values and their backing arrays may change while that topology is shared.
 */
export class TinyTriangularDistanceIndex {
  private readonly firstRegions: Int32Array
  private readonly secondRegions: Int32Array
  private readonly firstLocalIndexes: Int32Array
  private readonly secondLocalIndexes: Int32Array
  private readonly regionDegrees: Int32Array
  private readonly regionOffsets: Float64Array
  private readonly snapshotX: Float64Array
  private readonly snapshotY: Float64Array
  private readonly portRevisions: Uint32Array
  private readonly distances: Float64Array
  private readonly stamps: Uint32Array
  private epoch = 1
  private wraps = 0

  static forTopology(
    topology: TinyHyperGraphTopology,
    maximumBytes = MAX_DISTANCE_INDEX_BYTES,
  ): TinyTriangularDistanceIndex | undefined {
    const metadataBytes = topology.portCount * 36 + topology.regionCount * 12
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < metadataBytes ||
      !Number.isSafeInteger(topology.portCount) || topology.portCount < 0 ||
      !Number.isSafeInteger(topology.regionCount) || topology.regionCount < 0 ||
      topology.portX.length < topology.portCount || topology.portY.length < topology.portCount ||
      topology.incidentPortRegion.length < topology.portCount ||
      topology.regionIncidentPorts.length < topology.regionCount) return undefined
    if (maximumBytes === MAX_DISTANCE_INDEX_BYTES) {
      const existing = distanceIndexes.get(topology)
      if (existing) return existing
    }
    const index = new TinyTriangularDistanceIndex(topology, maximumBytes - metadataBytes)
    if (maximumBytes === MAX_DISTANCE_INDEX_BYTES) distanceIndexes.set(topology, index)
    return index
  }

  private constructor(topology: TinyHyperGraphTopology, pairBudgetBytes: number) {
    const { portCount, regionCount } = topology
    this.firstRegions = new Int32Array(portCount).fill(-1)
    this.secondRegions = new Int32Array(portCount).fill(-1)
    this.firstLocalIndexes = new Int32Array(portCount).fill(-1)
    this.secondLocalIndexes = new Int32Array(portCount).fill(-1)
    this.regionDegrees = new Int32Array(regionCount)
    this.regionOffsets = new Float64Array(regionCount).fill(-1)
    this.snapshotX = new Float64Array(portCount)
    this.snapshotY = new Float64Array(portCount)
    this.portRevisions = new Uint32Array(portCount).fill(1)
    for (let port = 0; port < portCount; port++) {
      this.snapshotX[port] = topology.portX[port]!
      this.snapshotY[port] = topology.portY[port]!
      this.firstRegions[port] = topology.incidentPortRegion[port]?.[0] ?? -1
      this.secondRegions[port] = topology.incidentPortRegion[port]?.[1] ?? -1
    }
    let pairs = 0
    for (let region = 0; region < regionCount; region++) {
      const ports = topology.regionIncidentPorts[region]!
      this.regionDegrees[region] = ports.length
      const pairCount = ports.length * (ports.length - 1) / 2
      if (Number.isSafeInteger(pairCount) && pairCount > 0 && (pairs + pairCount) * 12 <= pairBudgetBytes) {
        this.regionOffsets[region] = pairs
        pairs += pairCount
      }
      for (let local = 0; local < ports.length; local++) {
        const port = ports[local]!
        if (!Number.isInteger(port) || port < 0 || port >= portCount) continue
        if (this.firstRegions[port] === region) this.firstLocalIndexes[port] = local
        else if (this.secondRegions[port] === region) this.secondLocalIndexes[port] = local
      }
    }
    this.distances = new Float64Array(pairs)
    this.stamps = new Uint32Array(pairs)
  }

  get byteLength(): number {
    return this.firstRegions.byteLength + this.secondRegions.byteLength +
      this.firstLocalIndexes.byteLength + this.secondLocalIndexes.byteLength +
      this.regionDegrees.byteLength + this.regionOffsets.byteLength +
      this.snapshotX.byteLength + this.snapshotY.byteLength + this.portRevisions.byteLength +
      this.distances.byteLength + this.stamps.byteLength
  }

  get wrapGeneration(): number {
    return this.wraps
  }

  getSourceLocalIndex(port: number, region: number): number {
    if (this.firstRegions[port] === region) return this.firstLocalIndexes[port]!
    if (this.secondRegions[port] === region) return this.secondLocalIndexes[port]!
    return -1
  }

  refreshPort(port: number, x: number, y: number): number {
    if (!Number.isInteger(port) || port < 0 || port >= this.portRevisions.length) return 0
    if (!Object.is(this.snapshotX[port], x) || !Object.is(this.snapshotY[port], y)) {
      if (this.epoch === 0xffffffff) {
        this.stamps.fill(0)
        this.portRevisions.fill(1)
        this.epoch = 1
        this.wraps++
      }
      this.portRevisions[port] = ++this.epoch
      this.snapshotX[port] = x
      this.snapshotY[port] = y
    }
    return this.portRevisions[port]!
  }

  getDistance(
    region: number, sourceLocal: number, sourcePort: number, sourceRevision: number,
    sourceWrap: number, sourceX: number, sourceY: number,
    destinationLocal: number, destinationPort: number, destinationX: number, destinationY: number,
  ): number {
    const offset = this.regionOffsets[region]
    const degree = this.regionDegrees[region]
    // Large/unindexed regions, diagonal pairs and non-incident source hops use
    // the original expression. This is an explicit memory/shape eligibility.
    if (!(offset! >= 0) || !(sourceLocal >= 0 && sourceLocal < degree!) ||
      !(destinationLocal >= 0 && destinationLocal < degree!) || sourceLocal === destinationLocal ||
      sourceRevision === 0) {
      const dx = sourceX - destinationX
      const dy = sourceY - destinationY
      return Math.sqrt(dx * dx + dy * dy)
    }
    let destinationRevision = this.refreshPort(destinationPort, destinationX, destinationY)
    if (destinationRevision === 0) {
      const dx = sourceX - destinationX
      const dy = sourceY - destinationY
      return Math.sqrt(dx * dx + dy * dy)
    }
    if (sourceWrap !== this.wraps) {
      sourceRevision = this.refreshPort(sourcePort, sourceX, sourceY)
      // Refreshing an older source capture can itself wrap the epoch again.
      // Both revisions must belong to the final generation before stamping.
      destinationRevision = this.portRevisions[destinationPort]!
    }
    // A source captured before a nested/shared-cache coordinate mutation still
    // uses its original XY. Do not stamp that older capture as the new value.
    if (sourceRevision !== this.portRevisions[sourcePort]) {
      const dx = sourceX - destinationX
      const dy = sourceY - destinationY
      return Math.sqrt(dx * dx + dy * dy)
    }
    const lower = sourceLocal < destinationLocal ? sourceLocal : destinationLocal
    const upper = sourceLocal < destinationLocal ? destinationLocal : sourceLocal
    const position = offset! + upper * (upper - 1) / 2 + lower
    const stamp = sourceRevision > destinationRevision ? sourceRevision : destinationRevision
    if (this.stamps[position] === stamp) return this.distances[position]!
    const dx = sourceX - destinationX
    const dy = sourceY - destinationY
    const distance = Math.sqrt(dx * dx + dy * dy)
    this.distances[position] = distance
    this.stamps[position] = stamp
    return distance
  }
}
