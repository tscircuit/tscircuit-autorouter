import { expect, test } from "bun:test"
import { createVisibilityCorridorSearch } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/createVisibilityCorridorSearch"
import type { CorridorPathInput } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/createVisibilityCorridorSearch"

type Point = { x: number; y: number; z: number }

test("lazy multilayer families match an independent exhaustive finite-graph oracle without history-dependent constraints", (): void => {
  let seed = 8383
  for (let trial = 0; trial < 180; trial++) {
    const start = { x: -2, y: 0, z: 0 }, end = { x: 2, y: 0, z: 1 }
    const proposals: Point[] = [start]
    for (let index = 0; index < 7; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const x = seed / 2 ** 32 * 3 - 1.5
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const y = seed / 2 ** 32 * 3 - 1.5
      // Keep the proposed old path's layer transitions colocated, matching
      // the enclosing FindClearancePathSolver input contract.
      proposals.push({ x, y, z: 0 }, { x, y, z: 1 }, { x, y, z: 0 })
    }
    proposals.push({ ...end, z: 0 }, end)
    const sites = new Map<string, Point>([["start", start], ["end", end]])
    function clear(a: Point, b: Point): boolean {
      if (a.x === b.x && a.y === b.y && a.z === b.z)
        sites.set(`${a.x}:${a.y}:${a.z}`, a)
      const sameLayer = a.z === b.z
      const colocatedVia = a.x === b.x && a.y === b.y
      return sameLayer || colocatedVia
    }
    function extraCost(a: Point, b: Point): number {
      const blocked = a.z === b.z && (a.x + b.x) / 2 > 0.2 && (a.y + b.y) / 2 < -0.3
      const xPenalty = Math.abs(a.x + b.x) * 0.21
      const yPenalty = Math.abs(a.y + b.y) * 0.13
      if (blocked) return Infinity
      return xPenalty + yPenalty
    }
    const bounds = { minX: -3, maxX: 3, minY: -3, maxY: 3 }
    const input: CorridorPathInput = {
      srj: { bounds, layerCount: 2, connections: [], obstacles: [], minTraceWidth: 0.1 },
      routes: [], routeIndex: 0, start, end, bounds,
      traceThickness: 0.1, traceClearance: 0.1, viaClearance: 0.1,
      existingPath: proposals, maxNodes: 100000, heuristicWeight: 1,
    }
    const search = createVisibilityCorridorSearch({ input, barriers: [], clear, extraCost, clearsDrills: (): boolean => true, stats: { nodesPopped: 0, completionReason: "no-path" } })
    let result = search.step()
    while (result.status === "pending") result = search.step()
    // Use linear scans and full directed edge enumeration, with no frontier
    // families, heap, incumbent pruning or copied search bookkeeping.
    const all = [...sites.values()]
    const distances = all.map((): number => Infinity)
    const settled = new Set<number>()
    distances[0] = 0
    for (let iteration = 0; iteration < all.length; iteration++) {
      let best = -1
      for (let id = 0; id < all.length; id++)
        if (!settled.has(id) && (best < 0 || distances[id]! < distances[best]!)) best = id
      if (best < 0 || !Number.isFinite(distances[best]!)) break
      settled.add(best)
      for (let id = 0; id < all.length; id++) {
        const a = all[best]!, b = all[id]!
        if (settled.has(id) || !clear(a, b)) continue
        const geometric = a.z === b.z ? Math.hypot(a.x - b.x, a.y - b.y) : 1
        distances[id] = Math.min(distances[id]!, distances[best]! + geometric + extraCost(a, b))
      }
    }
    expect(Boolean(result.path)).toBe(Number.isFinite(distances[1]!))
    if (!result.path) continue
    let actualCost = 0
    for (let index = 1; index < result.path.length; index++) {
      const a = result.path[index - 1]!, b = result.path[index]!
      expect(clear(a, b)).toBe(true)
      actualCost += (a.z === b.z ? Math.hypot(a.x - b.x, a.y - b.y) : 1) + extraCost(a, b)
    }
    expect(Math.abs(actualCost - distances[1]!)).toBeLessThan(1e-8)
  }
})
