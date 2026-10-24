import { expect, test } from "bun:test"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import { createVisibilityCorridorSearch } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/createVisibilityCorridorSearch"
import type { CorridorPathInput } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/createVisibilityCorridorSearch"

type Point = { x: number; y: number; z: number }
type Box = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }

test("lazy visibility families match exhaustive shortest paths on their complete finite planar graph", (): void => {
  let seed = 381781
  for (let trial = 0; trial < 160; trial++) {
    const boxes: Box[] = []
    for (let index = 0; index < 5; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const x = (seed / 2 ** 32) * 2 - 1
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const y = (seed / 2 ** 32) * 2 - 1
      boxes.push({ minX: x - 0.08, maxX: x + 0.08, minY: y - 0.12, maxY: y + 0.12, minZ: 0, maxZ: 0 })
    }
    const start = { x: -2, y: 0, z: 0 }, end = { x: 2, y: 0, z: 0 }
    const input: CorridorPathInput = {
      srj: { bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, layerCount: 1, minTraceWidth: 0.1, connections: [], obstacles: [] },
      routes: [{ connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3, route: [start, end], vias: [] }],
      routeIndex: 0, start, end, bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      traceThickness: 0.1, traceClearance: 0.1, viaClearance: 0.1, allowLayerChanges: false,
      maxNodes: 100000, heuristicWeight: 1,
    }
    const siteMap = new Map<string, Point>([["start", start], ["end", end]])
    function clear(a: Point, b: Point): boolean {
      const permitted = boxes.every((box): boolean => segmentToBoundsMinDistance(a, b, box) + 1e-8 >= 0.15)
      if (permitted && a.x === b.x && a.y === b.y) siteMap.set(`${a.x}:${a.y}`, a)
      return permitted
    }
    function extraCost(a: Point, b: Point): number {
      const midpointX = (a.x + b.x) / 2
      const midpointY = (a.y + b.y) / 2
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const multiplier = midpointX > -0.4 && midpointX < 0.6 && midpointY < 0.3 ? 0.7 : 0
      return distance * multiplier
    }
    const stats = { nodesPopped: 0, completionReason: "no-path" as const }
    const search = createVisibilityCorridorSearch({ input, barriers: boxes, clear, extraCost, clearsDrills: (): boolean => true, stats })
    let result = search.step()
    while (result.status === "pending") result = search.step()
    const sites = [...siteMap.values()]
    const distances = sites.map((): number => Infinity)
    const closed = new Set<number>()
    distances[0] = 0
    for (let iteration = 0; iteration < sites.length; iteration++) {
      let best = -1
      for (let id = 0; id < sites.length; id++)
        if (!closed.has(id) && (best === -1 || distances[id]! < distances[best]!)) best = id
      if (best === -1 || !Number.isFinite(distances[best]!)) break
      closed.add(best)
      for (let id = 0; id < sites.length; id++) {
        if (closed.has(id) || !clear(sites[best]!, sites[id]!)) continue
        const cost = distances[best]! + Math.hypot(sites[best]!.x - sites[id]!.x, sites[best]!.y - sites[id]!.y) + extraCost(sites[best]!, sites[id]!)
        distances[id] = Math.min(distances[id]!, cost)
      }
    }
    if (!Number.isFinite(distances[1]!)) {
      expect(result.path).toBeNull()
      continue
    }
    expect(result.path).not.toBeNull()
    const path = result.path!
    let actual = 0
    for (let index = 1; index < path.length; index++) {
      expect(clear(path[index - 1]!, path[index]!)).toBe(true)
      actual += Math.hypot(path[index - 1]!.x - path[index]!.x, path[index - 1]!.y - path[index]!.y) + extraCost(path[index - 1]!, path[index]!)
    }
    expect(Math.abs(actual - distances[1]!)).toBeLessThan(1e-8)
  }
})
