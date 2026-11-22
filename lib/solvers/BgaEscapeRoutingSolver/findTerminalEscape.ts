import { PriorityQueue } from "lib/data-structures/PriorityQueue"
import type { SingleLayerConnectionPoint } from "lib/types"
import { cellsPerBallPitch, gridNeighbors } from "./BgaRoutingGrid"
import type { BgaRoutingCopper } from "./BgaRoutingCopper"

export type RoutingTerminal = {
  point: SingleLayerConnectionPoint
  owner: number
  width: number
  terminalId: string
  cell: number
}

export type TerminalEscape = { path: number[]; viaSite: number }
type EscapeSearch = { terminal: RoutingTerminal; countSites: boolean }
export type EscapeSites = {
  count: number
  distance: number
  escape?: TerminalEscape
}

/** Count nearby via sites before reserving the most constrained pads first. */
export function findTerminalEscape(
  { terminal, countSites }: EscapeSearch,
  copper: BgaRoutingCopper,
): EscapeSites {
  const { grid } = copper
  const wireMask = copper.wires.get(terminal.width)!
  const origin = terminal.cell
  if (wireMask[origin] !== 0 && wireMask[origin] !== terminal.owner) {
    return { count: 0, distance: Infinity }
  }
  const costs = new Map<number, number>([[origin, 0]])
  const parents = new Map<number, number>()
  const frontier = new PriorityQueue<{ cell: number; cost: number; f: number }>(
    [],
    Infinity,
  )
  frontier.enqueue({ cell: origin, cost: 0, f: 0 })
  let count = 0
  let distance = Infinity
  // Search up to three pitches along the surface. A long excursion is a routing
  // problem in its own right and does not qualify as a local pad escape.
  const maxSteps = 3 * cellsPerBallPitch
  while (!frontier.isEmpty()) {
    const { cell, cost } = frontier.dequeue()!
    if (cost !== costs.get(cell)) continue
    if (copper.canPlaceVia(cell % grid.layerSize, terminal.owner)) {
      count++
      distance = Math.min(distance, cost)
      if (!countSites) {
        const path = [cell]
        while (parents.has(path[path.length - 1]!)) {
          path.push(parents.get(path[path.length - 1]!)!)
        }
        return {
          count,
          distance,
          escape: { path: path.reverse(), viaSite: cell % grid.layerSize },
        }
      }
      // Additional sites cannot make an already unconstrained terminal scarce.
      if (count === 128) break
    }
    const col = cell % grid.columns
    const row = Math.floor(cell / grid.columns) % grid.rows
    for (const [dx, dy] of gridNeighbors) {
      const x = col + dx
      const y = row + dy
      if (x < 0 || x >= grid.columns || y < 0 || y >= grid.rows) continue
      const neighbor = cell + dx + dy * grid.columns
      const owner = wireMask[neighbor]
      if (owner !== 0 && owner !== terminal.owner) continue
      const nextCost = cost + (dx && dy ? Math.SQRT2 : 1)
      if (nextCost > maxSteps || nextCost >= (costs.get(neighbor) ?? Infinity))
        continue
      costs.set(neighbor, nextCost)
      parents.set(neighbor, cell)
      // Equal-cost candidates use board X, then board Y, independent of heap order.
      const f = nextCost + ((x * grid.rows + y) / grid.layerSize) * 1e-9
      frontier.enqueue({ cell: neighbor, cost: nextCost, f })
    }
  }
  return { count, distance }
}
