import type { Bounds, RepairRoutePoint } from "./repairRegionTypes"
import { ClearancePathHeap } from "./ClearancePathHeap"

type Point = RepairRoutePoint
type CorridorBarrier = Bounds & { viaOnly?: boolean }
type ViaPath = { x: number; y: number; previous?: ViaPath }

type CorridorSearchInput = {
  bounds: Bounds
  start: Point
  end: Point
  barriers: CorridorBarrier[]
  layerCount: number
  wireReach: number
  viaReach: number
  allowLayerChanges: boolean
  maxNodes: number
  heuristicWeight: number
  clear: (a: Point, b: Point) => boolean
  extraCost: (a: Point, b: Point) => number
  clearsDrills: (point: Point, vias: ViaPath | undefined) => boolean
  finish: (path: Point[] | null, nodes: number, reason: "found" | "no-path" | "node-limit", edgeChecks: number) => void
}

type CorridorSearch = { step: () => void; nodeCount: number }

/** A visibility graph of clearance-expanded barrier portals, with exact edges. */
export function createClearanceCorridorSearch(input: CorridorSearchInput): CorridorSearch | undefined {
  const { bounds, start, end, layerCount } = input
  const coordinates = [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, start.x, start.y, end.x, end.y]
  if (!coordinates.every(Number.isFinite) || bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) throw new Error("Clearance corridor coordinates and bounds must be finite with positive area")
  if (!Number.isSafeInteger(layerCount) || layerCount < 1 || ![start.z, end.z].every((z): boolean => Number.isSafeInteger(z) && z >= 0 && z < layerCount)) throw new Error("Clearance corridor anchors require valid copper layers")
  if (![input.wireReach, input.viaReach].every((reach): boolean => Number.isFinite(reach) && reach > 0) || !Number.isSafeInteger(input.maxNodes) || input.maxNodes < 1 || !Number.isFinite(input.heuristicWeight) || input.heuristicWeight < 1) throw new Error("Clearance corridor search requires finite positive geometry and work limits")
  if (!input.barriers.every((barrier): boolean => [barrier.minX, barrier.maxX, barrier.minY, barrier.maxY].every(Number.isFinite) && barrier.minX <= barrier.maxX && barrier.minY <= barrier.maxY)) throw new Error("Clearance corridor barriers require finite ordered bounds")
  const sites = new Map<string, { x: number; y: number }>()
  const addSite = (x: number, y: number): void => {
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) return
    sites.set(`${x},${y}`, { x, y })
  }
  addSite(start.x, start.y)
  addSite(end.x, end.y)
  for (const barrier of input.barriers) {
    for (const reach of barrier.viaOnly ? [input.viaReach] : [input.wireReach, input.viaReach]) {
      const minX = barrier.minX - reach, maxX = barrier.maxX + reach
      const minY = barrier.minY - reach, maxY = barrier.maxY + reach
      if (maxX < bounds.minX || minX > bounds.maxX || maxY < bounds.minY || minY > bounds.maxY) continue
      addSite(minX, minY)
      addSite(minX, maxY)
      addSite(maxX, minY)
      addSite(maxX, maxY)
    }
    // Select the representation before beginning search; graph exhaustion is
    // an ordinary no-path result and never retries another algorithm.
    if (sites.size * layerCount > 2048) return undefined
  }
  if (!sites.has(`${start.x},${start.y}`) || !sites.has(`${end.x},${end.y}`)) return undefined
  const points = [...sites.values()].flatMap((site): Point[] =>
    Array.from({ length: layerCount }, (_, z): Point => ({ ...site, z, traceThickness: start.traceThickness })),
  )
  const startId = start.z
  const endSite = [...sites.keys()].indexOf(`${end.x},${end.y}`)
  const endId = endSite * layerCount + end.z
  if (!points[startId] || !points[endId]) throw new Error("Clearance corridor anchors are outside the graph")
  const costs = new Float64Array(points.length).fill(Infinity)
  const previous = new Int32Array(points.length).fill(-1)
  const settled = new Uint8Array(points.length)
  const viaPaths: Array<ViaPath | undefined> = Array(points.length)
  const heap = new ClearancePathHeap(points.length)
  const estimate = (point: Point): number => Math.hypot(point.x - end.x, point.y - end.y) + (point.z === end.z ? 0 : 1)
  costs[startId] = 0
  heap.push({ id: startId, cost: 0, priority: input.heuristicWeight * estimate(start) })
  let edgeChecks = 0
  let popped = 0
  let finished = false
  const step = (): void => {
    if (finished) throw new Error("Clearance corridor search stepped after completion")
    const stopAt = Math.min(popped + 16, input.maxNodes)
    while (heap.length && popped < stopAt) {
      const current = heap.pop()
      popped++
      if (current.cost !== costs[current.id]) continue
      if (input.heuristicWeight > 1) settled[current.id] = 1
      if (current.id === endId) {
        const path: Point[] = []
        for (let id = endId; id !== -1; id = previous[id]!) path.push({ ...points[id]! })
        path.reverse()
        path[0] = start
        path[path.length - 1] = end
        finished = true
        input.finish(path, popped, "found", edgeChecks)
        return
      }
      const a = points[current.id]!
      for (let id = 0; id < points.length; id++) {
        if (id === current.id || settled[id]) continue
        const b = points[id]!
        const via = a.z !== b.z
        if (via && (!input.allowLayerChanges || a.x !== b.x || a.y !== b.y || !input.clearsDrills(a, viaPaths[current.id]))) continue
        const baseCost = current.cost + (via ? 1 : Math.hypot(a.x - b.x, a.y - b.y))
        if (baseCost >= costs[id]!) continue
        edgeChecks++
        if (!input.clear(a, b)) continue
        const cost = baseCost + input.extraCost(a, b)
        if (!Number.isFinite(cost) || cost >= costs[id]!) continue
        costs[id] = cost
        previous[id] = current.id
        const priorVias = viaPaths[current.id]
        viaPaths[id] = via && (a.x !== priorVias?.x || a.y !== priorVias?.y)
          ? { x: a.x, y: a.y, previous: priorVias }
          : priorVias
        heap.push({ id, cost, priority: cost + input.heuristicWeight * estimate(b) })
      }
    }
    if (heap.length && popped < input.maxNodes) return
    finished = true
    input.finish(null, popped, heap.length ? "node-limit" : "no-path", edgeChecks)
  }
  return { step, nodeCount: points.length }
}
