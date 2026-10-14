import {
  GridRouter,
  type Dataset,
  type RouterConfig,
} from "../../src/gridRouter"

export const emptyBoard: Dataset = {
  bounds: { minX: 0, minY: 0, maxX: 12, maxY: 12 },
  layerCount: 2,
  minTraceWidth: 0.1,
  obstacles: [],
  connections: [],
}

export function searchCost(
  router: GridRouter,
  start: number,
  goal: number,
): { cost: number; vias: number } {
  const result = router.search(
    [{ id: start, distance: 0 }],
    [{ id: goal, distance: 0 }],
    router.point(goal),
    0.1,
    "net",
  )
  if (!result) return { cost: Infinity, vias: 0 }
  let cost = 0,
    vias = 0
  for (let k = 1; k < result.ids.length; k++) {
    const a = result.ids[k - 1],
      b = result.ids[k]
    if (router.layer(a) !== router.layer(b)) {
      cost += router.config.viaPenalty
      vias++
    } else {
      const p = router.point(a),
        q = router.point(b)
      cost += Math.hypot(p.x - q.x, p.y - q.y)
    }
  }
  return { cost, vias }
}

/** Independent Dijkstra over the complete graph, without certificates or A* heuristic. */
export function dijkstraCost(
  router: GridRouter,
  start: number,
  goal: number,
): number {
  const distances = new Map([[start, 0]]),
    queue: [number, number][] = [[start, 0]],
    closed = new Set<number>()
  while (queue.length) {
    queue.sort((a, b) => b[1] - a[1])
    const [id, cost] = queue.pop()!
    if (closed.has(id)) continue
    if (id === goal) return cost
    closed.add(id)
    const p = router.point(id),
      node = Math.floor(id / router.layers.length),
      layer = router.layer(id),
      i = (node % router.nx) + router.minI,
      j = Math.floor(node / router.nx) + router.minJ
    const relax = (next: number, extra: number): void => {
      if (
        closed.has(next) ||
        (distances.has(next) && distances.get(next)! <= cost + extra)
      )
        return
      distances.set(next, cost + extra)
      queue.push([next, cost + extra])
    }
    for (const [di, dj] of router.grid.directions) {
      if (
        i + di < router.minI ||
        i + di > router.maxI ||
        j + dj < router.minJ ||
        j + dj > router.maxJ
      )
        continue
      const next = router.state(i + di, j + dj, layer),
        q = router.point(next)
      if (router.segmentLegal(p, q, layer, 0.05, "net"))
        relax(next, Math.hypot(p.x - q.x, p.y - q.y))
    }
    if (router.viaLegal(p, "net"))
      for (let l = 0; l < router.layers.length; l++)
        if (l !== layer)
          relax(node * router.layers.length + l, router.config.viaPenalty)
  }
  return Infinity
}

export function makeRouter(
  grid: "hex" | "oct",
  layerPruning: RouterConfig["layerPruning"],
  input: Dataset = emptyBoard,
): GridRouter {
  return new GridRouter(input, {
    grid,
    layerPruning,
    pitch: 0.5,
    timeLimit: 60,
  })
}
