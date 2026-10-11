import { regionScoringKernelBytes } from "./regionScoringKernelBytes"
import type { RegionIntersectionCache } from "tiny-hypergraph/lib/types"

const MAX_BYTES = 512 * 1024 * 1024
let module: WebAssembly.Module | undefined

export type TinyRegionScoringTopology = {
  firstRegion: Int32Array
  secondRegion: Int32Array
  angle1: Int32Array
  angle2?: Int32Array
  z: Int32Array
  penalty?: Float64Array
}
export type TinyRegionScoringQuery = {
  region: number
  sourcePort: number
  currentNet: number
  neighbors: Int32Array
  distances: Float64Array
  maximumCosts: Float64Array
  candidateG: number
  congestion: number
  distanceScale: number
  width: number
  height: number
  availableLayers: number
  padDiameter: number
  densityFactor: number
  cache: RegionIntersectionCache
}
export type TinyRegionScoringBatch = {
  count: number
  g: Float64Array
  regionCost: Float64Array
  same: Int32Array
  cross: Int32Array
  changes: Int32Array
  lesser: Int32Array
  greater: Int32Array
  layers: Int32Array
  /** bit0: geometry scratch visited; bit1: region-cost/memo visited. */
  flags: Uint8Array
}
type Exports = {
  memory: WebAssembly.Memory
  __heap_base: WebAssembly.Global
  score_region(...arguments_: number[]): void
}

/**
 * Isolated numeric proof helper, unused by production routing. The constructor
 * snapshots numeric topology; callers supply an immutable owned topology or
 * construct a new helper for changes. Queries copy their live cache and batch
 * vectors before one C call. Returned views are reused by the next query.
 *
 * It never mutates the native geometry scratch, cost memo, routing state or
 * candidate queue. A future caller must commit scratch/memo only for original
 * JS visitors that survive the current best-cost and first-goal checks.
 */
export class TinyRegionScoringKernel {
  private readonly exports: Exports
  private readonly pointers: number[]
  private readonly inputs: {
    neighbors: Int32Array; distances: Float64Array; maximumCosts: Float64Array
    net: Int32Array; lesser: Int32Array; greater: Int32Array; layers: Int32Array
  }
  readonly batch: TinyRegionScoringBatch
  readonly diagnostics = { batches: 0, candidates: 0, copiedSegments: 0, bytes: 0 }
  private readonly portCount: number

  constructor(topology: TinyRegionScoringTopology,
    private readonly maximumNeighbors: number,
    private readonly maximumSegments: number) {
    this.portCount = topology.z.length
    if (!Number.isInteger(maximumNeighbors) || maximumNeighbors < 0 ||
      !Number.isInteger(maximumSegments) || maximumSegments < 0 || this.portCount > 0x7fffffff ||
      topology.firstRegion.length !== this.portCount || topology.secondRegion.length !== this.portCount ||
      topology.angle1.length !== this.portCount || (topology.angle2 && topology.angle2.length !== this.portCount) ||
      (topology.penalty && topology.penalty.length !== this.portCount))
      throw new Error("Invalid pure region-scoring numeric layout")
    const byteBound = 65536 + 22 * 8 + this.portCount * 28 + maximumNeighbors * 61 + maximumSegments * 16
    if (!Number.isSafeInteger(byteBound) || byteBound > MAX_BYTES)
      throw new Error("Pure region-scoring numeric layout exceeds its resource bound")
    module ??= new WebAssembly.Module(regionScoringKernelBytes)
    this.exports = new WebAssembly.Instance(module).exports as unknown as Exports
    let next = Number(this.exports.__heap_base.value)
    const pointers: number[] = []
    const allocate = (bytes: number): number => {
      next = Math.ceil(next / 8) * 8
      const pointer = next; next += bytes; pointers[pointers.length] = pointer
      return pointer
    }
    for (let column = 0; column < 5; column++) allocate(this.portCount * 4)
    allocate(this.portCount * 8)
    allocate(maximumNeighbors * 4)
    allocate(maximumNeighbors * 8); allocate(maximumNeighbors * 8)
    for (let column = 0; column < 4; column++) allocate(maximumSegments * 4)
    allocate(maximumNeighbors * 8); allocate(maximumNeighbors * 8)
    for (let column = 0; column < 6; column++) allocate(maximumNeighbors * 4)
    allocate(maximumNeighbors)
    if (next > MAX_BYTES) throw new Error("Pure region-scoring allocation exceeds its resource bound")
    const missing = Math.ceil(next / 65536) - this.exports.memory.buffer.byteLength / 65536
    if (missing > 0) this.exports.memory.grow(missing)
    const buffer = this.exports.memory.buffer
    this.pointers = pointers
    const i32 = (index: number, length: number): Int32Array => new Int32Array(buffer, pointers[index], length)
    const f64 = (index: number, length: number): Float64Array => new Float64Array(buffer, pointers[index], length)
    i32(0, this.portCount).set(topology.firstRegion); i32(1, this.portCount).set(topology.secondRegion)
    i32(2, this.portCount).set(topology.angle1); i32(3, this.portCount).set(topology.angle2 ?? topology.angle1)
    i32(4, this.portCount).set(topology.z)
    if (topology.penalty) f64(5, this.portCount).set(topology.penalty)
    this.inputs = { neighbors: i32(6, maximumNeighbors), distances: f64(7, maximumNeighbors),
      maximumCosts: f64(8, maximumNeighbors), net: i32(9, maximumSegments),
      lesser: i32(10, maximumSegments), greater: i32(11, maximumSegments), layers: i32(12, maximumSegments) }
    this.batch = { count: 0, g: f64(13, maximumNeighbors), regionCost: f64(14, maximumNeighbors),
      same: i32(15, maximumNeighbors), cross: i32(16, maximumNeighbors), changes: i32(17, maximumNeighbors),
      lesser: i32(18, maximumNeighbors), greater: i32(19, maximumNeighbors), layers: i32(20, maximumNeighbors),
      flags: new Uint8Array(buffer, pointers[21], maximumNeighbors) }
    this.diagnostics.bytes = next
  }

  score(query: TinyRegionScoringQuery): TinyRegionScoringBatch {
    const count = query.neighbors.length, cache = query.cache, length = cache.netIds.length
    if (count > this.maximumNeighbors || length > this.maximumSegments ||
      query.distances.length !== count || query.maximumCosts.length !== count ||
      cache.lesserAngles.length !== length || cache.greaterAngles.length !== length || cache.layerMasks.length !== length ||
      !Number.isInteger(query.sourcePort) || query.sourcePort < 0 || query.sourcePort >= this.portCount ||
      !Number.isInteger(query.region) || query.region < 0 || query.region > 0x7fffffff ||
      query.currentNet !== (query.currentNet | 0) || query.availableLayers !== (query.availableLayers | 0))
      throw new Error("Pure region-scoring query is outside its numeric layout")
    for (let row = 0; row < count; row++) if (query.neighbors[row]! < 0 || query.neighbors[row]! >= this.portCount)
      throw new Error("Pure region-scoring query contains an invalid neighbor")
    this.inputs.neighbors.set(query.neighbors); this.inputs.distances.set(query.distances)
    this.inputs.maximumCosts.set(query.maximumCosts)
    this.inputs.net.set(cache.netIds); this.inputs.lesser.set(cache.lesserAngles)
    this.inputs.greater.set(cache.greaterAngles); this.inputs.layers.set(cache.layerMasks)
    const p = this.pointers
    this.exports.score_region(p[0]!, p[1]!, p[2]!, p[3]!, p[4]!, p[5]!, p[6]!, p[7]!, p[8]!,
      p[9]!, p[10]!, p[11]!, p[12]!, p[13]!, p[14]!, p[15]!, p[16]!, p[17]!, p[18]!, p[19]!, p[20]!, p[21]!,
      count, length, query.sourcePort, query.region, query.currentNet, query.availableLayers,
      query.candidateG, query.congestion, query.distanceScale, query.width, query.height,
      query.padDiameter, query.densityFactor, cache.existingSameLayerIntersections,
      cache.existingCrossingLayerIntersections, cache.existingEntryExitLayerChanges,
      cache.existingSegmentCount, cache.existingRegionCost)
    this.batch.count = count
    this.diagnostics.batches++
    this.diagnostics.candidates += count
    this.diagnostics.copiedSegments += length
    return this.batch
  }
}
