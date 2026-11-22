import { PriorityQueue } from "lib/data-structures/PriorityQueue"
import { cellsPerBallPitch, gridNeighbors } from "./BgaRoutingGrid"
import type { BgaRoutingCopper } from "./BgaRoutingCopper"

type TrackEndpoints = {
  start: number
  end: number
  owner: number
  width: number
}
type GridStep = {
  cell: number
  distance: number
  x: number
  y: number
  z: number
}
type SearchCandidate = { cell: number; f: number }

/** A planar step consumes one cell. A change of layer places a through via. */
export class BgaTrackSearch {
  private readonly costs: Float64Array
  private readonly parents: Int32Array
  private readonly visited: Uint8Array
  private frontier = new PriorityQueue<SearchCandidate>([], Infinity)
  private endpoints!: TrackEndpoints
  private wires!: Int32Array
  private readonly viaCost: number
  private endColumn = 0
  private endRow = 0
  private endLayer = 0
  path?: number[]
  active = false
  failure?: "no_path" | "frontier_limit"

  constructor(private readonly copper: BgaRoutingCopper) {
    const { grid } = copper
    this.costs = new Float64Array(grid.cellCount)
    this.parents = new Int32Array(grid.cellCount)
    this.visited = new Uint8Array(grid.cellCount)
    // Price an added drill at two pitches of planar travel.
    this.viaCost = 2 * cellsPerBallPitch
  }

  start(endpoints: TrackEndpoints): void {
    const { grid } = this.copper
    this.endpoints = endpoints
    this.costs.fill(Infinity)
    this.visited.fill(0)
    this.costs[endpoints.start] = 0
    this.frontier = new PriorityQueue<SearchCandidate>([], Infinity)
    this.frontier.enqueue({ cell: endpoints.start, f: 0 })
    this.wires = this.copper.wires.get(endpoints.width)!
    this.endColumn = endpoints.end % grid.columns
    this.endRow = Math.floor(endpoints.end / grid.columns) % grid.rows
    this.endLayer = Math.floor(endpoints.end / grid.layerSize)
    this.path = undefined
    this.failure = undefined
    this.active = true
  }

  private enqueue(from: number, move: GridStep): void {
    const { cell, distance, x, y, z } = move
    const owner = this.wires[cell]
    if (this.visited[cell] || (owner !== 0 && owner !== this.endpoints.owner))
      return
    const cost = this.costs[from]! + distance
    if (cost >= this.costs[cell]! - 1e-6) return
    this.costs[cell] = cost
    this.parents[cell] = from
    const dx = Math.abs(x - this.endColumn)
    const dy = Math.abs(y - this.endRow)
    const planarDistance =
      Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
    const remaining = planarDistance + (z === this.endLayer ? 0 : this.viaCost)
    // Weighted octile A* favors progress across open routing layers.
    this.frontier.enqueue({ cell, f: cost + 1.125 * remaining })
  }

  /** Yield between batches so a long A* search can be cancelled or visualized. */
  step(): void {
    const { grid } = this.copper
    const { start, end, owner } = this.endpoints
    for (let work = 0; work < 4096 && !this.frontier.isEmpty(); work++) {
      // Bound the separately allocated priority-queue entries as well as the grid.
      if (this.frontier.size > 262_144) {
        this.failure = "frontier_limit"
        return
      }
      const { cell } = this.frontier.dequeue()!
      if (this.visited[cell]) continue
      this.visited[cell] = 1
      if (cell === end) {
        const path = [cell]
        while (path[path.length - 1] !== start) {
          path.push(this.parents[path[path.length - 1]!]!)
        }
        this.path = path.reverse()
        this.active = false
        return
      }
      const x = cell % grid.columns
      const y = Math.floor(cell / grid.columns) % grid.rows
      const z = Math.floor(cell / grid.layerSize)
      for (const [dx, dy] of gridNeighbors) {
        const col = x + dx
        const row = y + dy
        if (col < 0 || col >= grid.columns || row < 0 || row >= grid.rows)
          continue
        this.enqueue(cell, {
          cell: cell + dx + dy * grid.columns,
          distance: dx && dy ? Math.SQRT2 : 1,
          x: col,
          y: row,
          z,
        })
      }
      // Terminal vias are reserved on every layer. Each end of this branch
      // may use its own barrel even when additional drilling here is forbidden.
      const site = cell % grid.layerSize
      const terminalVia =
        site === start % grid.layerSize || site === end % grid.layerSize
      if (!terminalVia && !this.copper.canPlaceVia(site, owner)) continue
      for (let layer = 0; layer < grid.layerCount; layer++) {
        if (layer === z) continue
        this.enqueue(cell, {
          cell: layer * grid.layerSize + site,
          distance: this.viaCost,
          x,
          y,
          z: layer,
        })
      }
    }
    if (this.frontier.isEmpty()) this.failure = "no_path"
  }
}
