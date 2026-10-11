import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { computeRegionCost } from "tiny-hypergraph/lib/computeRegionCost"

export type TinyRegionCostMethod = (regionId: number, same: number, cross: number,
  changes: number, count: number) => number

type RegionCostDiagnostics = { hits: number; misses: number; unsupported: number;
  policyInvalidations: number; geometryInvalidations: number }

/** Four native numeric cost tuples per region, independent of route occupancy. */
export class TinyRegionCostMemo {
  private readonly rows: Float64Array
  private readonly areas: Float64Array
  private readonly layerMasks: Float64Array
  private readonly layerCounts: Uint8Array
  private readonly singleLayer: Uint8Array
  private readonly geometryValid: Uint8Array
  private readonly counts: Uint8Array
  private readonly order: Uint8Array
  private padDiameter?: number
  private densityFactor?: number
  private viaSquare = 0
  private policyValid = false
  collectDiagnostics = false
  readonly diagnostics: RegionCostDiagnostics = { hits: 0, misses: 0, unsupported: 0,
    policyInvalidations: 0, geometryInvalidations: 0 }

  constructor(private readonly solver: TinyHyperGraphSolver,
    private readonly nativeCost: TinyRegionCostMethod) {
    const count = solver.topology.regionCount
    this.rows = new Float64Array(count * 4 * 5)
    this.areas = new Float64Array(count)
    this.layerMasks = new Float64Array(count)
    this.layerCounts = new Uint8Array(count)
    this.singleLayer = new Uint8Array(count)
    this.geometryValid = new Uint8Array(count)
    this.counts = new Uint8Array(count)
    // Four two-bit row indices, most recently used first. Moving the byte avoids
    // copying twenty Float64 tuple/cost fields whenever an older row is hit.
    this.order = new Uint8Array(count).fill(0b11100100)
  }

  get(regionId: number, same: number, cross: number, changes: number, count: number): number {
    const solver = this.solver
    // Typed region rows cover native integer region IDs. Non-numeric public
    // policy values can have coercion side effects, so retain the native call.
    if (regionId !== (regionId >>> 0) || regionId >= this.counts.length ||
      typeof same !== "number" || typeof cross !== "number" ||
      typeof changes !== "number" || typeof count !== "number") {
      if (this.collectDiagnostics) this.diagnostics.unsupported++
      return this.nativeCost(regionId, same, cross, changes, count)
    }
    // Native argument evaluation captures geometry before policy fields. A
    // numeric policy getter can mutate the live topology while being read.
    const width = solver.topology.regionWidth[regionId]!
    const height = solver.topology.regionHeight[regionId]!
    const mask = solver.topology.regionAvailableZMask?.[regionId] ?? 0
    const padDiameter = solver.minViaPadDiameter
    const densityFactor = solver.TRACE_DENSITY_COST_FACTOR
    if (typeof mask !== "number" ||
      (typeof padDiameter !== "number" && padDiameter !== undefined && padDiameter !== null) ||
      (typeof densityFactor !== "number" && densityFactor !== undefined && densityFactor !== null)) {
      if (this.collectDiagnostics) this.diagnostics.unsupported++
      // Keep the already captured argument values. Reading a public accessor
      // again through the core method could mutate them a second time.
      return computeRegionCost(width, height, same, cross, changes, count,
        mask, padDiameter, densityFactor)
    }
    const area = width * height
    if (!this.policyValid || !Object.is(this.padDiameter, padDiameter) || !Object.is(this.densityFactor, densityFactor)) {
      this.counts.fill(0)
      if (this.collectDiagnostics && this.policyValid) this.diagnostics.policyInvalidations++
      this.policyValid = true
      this.padDiameter = padDiameter
      this.densityFactor = densityFactor
      const diameter = padDiameter === undefined ? 0.3 : padDiameter
      this.viaSquare = (diameter + 0.15) ** 2
    }
    if (!this.geometryValid[regionId] || !Object.is(this.areas[regionId], area) ||
      !Object.is(this.layerMasks[regionId], mask)) {
      if (this.collectDiagnostics && this.geometryValid[regionId]) this.diagnostics.geometryInvalidations++
      this.geometryValid[regionId] = 1
      this.areas[regionId] = area
      this.layerMasks[regionId] = mask
      this.counts[regionId] = 0
      this.singleLayer[regionId] = mask > 0 && (mask & (mask - 1)) === 0 ? 1 : 0
      let remaining = mask >>> 0
      let layers = mask === 0 ? 2 : 0
      while (remaining !== 0) {
        layers += remaining & 1
        remaining >>>= 1
      }
      this.layerCounts[regionId] = layers
    }
    const available = this.counts[regionId]!
    const order = this.order[regionId]!
    const base = regionId * 20
    for (let rank = 0; rank < available; rank++) {
      const rowId = (order >>> (rank * 2)) & 3
      const row = base + rowId * 5
      if (!Object.is(this.rows[row], same) || !Object.is(this.rows[row + 1], cross) ||
        !Object.is(this.rows[row + 2], changes) || !Object.is(this.rows[row + 3], count)) continue
      if (rank !== 0) {
        const lower = (1 << (rank * 2)) - 1
        this.order[regionId] = (order & ~((1 << ((rank + 1) * 2)) - 1)) |
          ((order & lower) << 2) | rowId
      }
      if (this.collectDiagnostics) this.diagnostics.hits++
      return this.rows[row + 4]!
    }
    // Preserve the pinned native expression order, including 0 * Infinity and
    // the exact 0.1 ** 2 value. A cached coefficient divided by area would round
    // differently. Historical state.existingRegionCost remains untouched.
    const estimatedVias = same * 2 + cross * 1 + changes * 1
    const traceCountMultiplier = 1 + count / 5
    const impossibleCost = this.singleLayer[regionId] ? same * 10 : 0
    const factor = densityFactor === undefined ? 0 : densityFactor
    const densityCost = (factor * (count / this.layerCounts[regionId]!) ** 2 * 0.1 ** 2) / area
    const cost = (estimatedVias * this.viaSquare * traceCountMultiplier) / area + impossibleCost + densityCost
    const rank = Math.min(available, 3)
    const rowId = (order >>> (rank * 2)) & 3
    const row = base + rowId * 5
    this.rows[row] = same
    this.rows[row + 1] = cross
    this.rows[row + 2] = changes
    this.rows[row + 3] = count
    this.rows[row + 4] = cost
    const lower = (1 << (rank * 2)) - 1
    this.order[regionId] = (order & ~((1 << ((rank + 1) * 2)) - 1)) |
      ((order & lower) << 2) | rowId
    if (available < 4) this.counts[regionId] = available + 1
    if (this.collectDiagnostics) this.diagnostics.misses++
    return cost
  }
}
