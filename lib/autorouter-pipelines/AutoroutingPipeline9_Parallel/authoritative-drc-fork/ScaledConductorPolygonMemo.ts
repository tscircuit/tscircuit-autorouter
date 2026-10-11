import type { Polygon } from "@flatten-js/core"

type PolygonRow = { polygon: Polygon | undefined; edges: number }

/** Private native polygons; callers only read them and never publish their aliases. */
export class ScaledConductorPolygonMemo {
  private readonly rows = new Map<number, PolygonRow>()
  private retainedEdges = 0
  readonly diagnostics = { hits: 0, misses: 0, creations: 0, evictions: 0, entries: 0, edges: 0, oversized: 0 }

  constructor(private readonly maximumEntries = 16_384, private readonly maximumEdges = 65_536) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries <= 0 || !Number.isSafeInteger(maximumEdges) || maximumEdges <= 0) {
      throw new RangeError("ScaledConductorPolygonMemo requires positive integer storage limits")
    }
  }

  /** IDs come from complete live native geometry snapshots in the same private owner. */
  getOrCreate(geometryId: number, createPolygon: () => Polygon): Polygon | undefined {
    if (!Number.isSafeInteger(geometryId) || geometryId <= 0) {
      throw new RangeError("ScaledConductorPolygonMemo requires a positive native geometry ID")
    }
    const previous = this.rows.get(geometryId)
    if (previous !== undefined) {
      this.diagnostics.hits++
      return previous.polygon
    }
    this.diagnostics.misses++
    // Creation/isEmpty/scale keep the original native arithmetic and order.
    // A thrown constructor or scale is never recorded, including its Error.
    const original = createPolygon()
    const polygon = original.isEmpty() ? undefined : original.scale(1e6, 1e6)
    this.diagnostics.creations++
    const edges = polygon?.edges.size ?? 0
    if (edges > this.maximumEdges) {
      this.diagnostics.oversized++
      return polygon
    }
    while (this.rows.size >= this.maximumEntries || this.retainedEdges + edges > this.maximumEdges) {
      const firstId = this.rows.keys().next().value!
      const first = this.rows.get(firstId)!
      this.retainedEdges -= first.edges
      this.rows.delete(firstId)
      this.diagnostics.evictions++
    }
    this.rows.set(geometryId, { polygon, edges })
    this.retainedEdges += edges
    this.diagnostics.entries = this.rows.size
    this.diagnostics.edges = this.retainedEdges
    return polygon
  }
}
