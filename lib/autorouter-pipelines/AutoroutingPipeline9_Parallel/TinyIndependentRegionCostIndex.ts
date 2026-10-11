import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import type { TinyBitsetRegionCost } from "./TinyBitsetRegionCostCache"

/** Exact native costs for the empty regions visited by independent routes. */
export class TinyIndependentRegionCostIndex {
  private readonly costs: Float64Array
  private readonly valid: Uint8Array
  private readonly widths: Float64Array
  private readonly heights: Float64Array
  private readonly layerMasks: Int32Array
  private minViaPadDiameter = Number.NaN
  private densityFactor = Number.NaN
  collectDiagnostics = false
  readonly diagnostics = { hits: 0, misses: 0 }

  constructor(private readonly solver: TinyHyperGraphSolver,
    private readonly nativeRegionCost: TinyBitsetRegionCost) {
    this.costs = new Float64Array(solver.topology.regionCount * 2)
    this.valid = new Uint8Array(this.costs.length)
    this.widths = new Float64Array(solver.topology.regionCount).fill(Number.NaN)
    this.heights = new Float64Array(solver.topology.regionCount).fill(Number.NaN)
    this.layerMasks = new Int32Array(solver.topology.regionCount)
  }

  reset(): void {
    this.valid.fill(0)
    this.minViaPadDiameter = this.solver.minViaPadDiameter
    this.densityFactor = this.solver.TRACE_DENSITY_COST_FACTOR
  }

  get(regionId: number, sameLayer: number, crossLayer: number,
    entryExitChanges: number, segmentCount: number): number {
    if (sameLayer !== 0 || crossLayer !== 0 || segmentCount !== 1 ||
      (entryExitChanges !== 0 && entryExitChanges !== 1)) {
      return this.nativeRegionCost(regionId, sameLayer, crossLayer, entryExitChanges, segmentCount)
    }
    const { solver } = this
    if (!Object.is(this.minViaPadDiameter, solver.minViaPadDiameter) ||
      !Object.is(this.densityFactor, solver.TRACE_DENSITY_COST_FACTOR)) this.reset()
    const width = solver.topology.regionWidth[regionId]
    const height = solver.topology.regionHeight[regionId]
    const mask = solver.topology.regionAvailableZMask?.[regionId] ?? 0
    if (!Object.is(this.widths[regionId], width) ||
      !Object.is(this.heights[regionId], height) || this.layerMasks[regionId] !== mask) {
      this.widths[regionId] = width
      this.heights[regionId] = height
      this.layerMasks[regionId] = mask
      this.valid[regionId * 2] = 0
      this.valid[regionId * 2 + 1] = 0
    }
    const key = regionId * 2 + entryExitChanges
    if (this.valid[key]) {
      if (this.collectDiagnostics) this.diagnostics.hits++
      return this.costs[key]!
    }
    const cost = this.nativeRegionCost(regionId, sameLayer, crossLayer, entryExitChanges, segmentCount)
    this.costs[key] = cost
    this.valid[key] = 1
    if (this.collectDiagnostics) this.diagnostics.misses++
    return cost
  }
}
