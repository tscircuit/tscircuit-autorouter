import type { Bounds, GridProvider } from "./gridRouter"

/** Search-local certificates: they must never survive a copper commit or net change. */
export class ClearRegionPruner {
  readonly certificates = new Map<string, boolean>()
  readonly spans: number[] = []
  checks = 0
  certified = 0

  constructor(
    readonly grid: GridProvider,
    readonly indices: {
      minI: number
      maxI: number
      minJ: number
      maxJ: number
    },
    readonly certify: (bounds: Bounds) => boolean,
  ) {
    // Nested patches up to approximately 5 mm, down to four grid intervals.
    // Hex patches are parallelograms; certifying their enclosing box is conservative.
    const largest = 2 ** Math.floor(Math.log2(Math.max(4, 5 / grid.pitch)))
    for (let span = largest; span >= 4; span /= 2) this.spans.push(span)
  }

  allowsLayerChange(i: number, j: number, gateway: boolean): boolean {
    if (gateway) return true
    for (const span of this.spans) {
      const a = Math.floor(i / span) * span,
        b = Math.floor(j / span) * span
      // Every entry/exit vertex remains a gateway, including diagonal hex/oct moves.
      if (i === a || j === b) continue
      if (
        a < this.indices.minI ||
        a + span > this.indices.maxI ||
        b < this.indices.minJ ||
        b + span > this.indices.maxJ
      )
        continue
      const key = `${span},${a},${b}`
      let clear = this.certificates.get(key)
      if (clear === undefined) {
        const corners = [
          this.grid.point(a, b),
          this.grid.point(a + span, b),
          this.grid.point(a, b + span),
          this.grid.point(a + span, b + span),
        ]
        this.checks++
        clear = this.certify({
          minX: Math.min(...corners.map((p) => p.x)),
          maxX: Math.max(...corners.map((p) => p.x)),
          minY: Math.min(...corners.map((p) => p.y)),
          maxY: Math.max(...corners.map((p) => p.y)),
        })
        this.certificates.set(key, clear)
        if (clear) this.certified++
      }
      if (clear) return false
    }
    return true
  }
}
