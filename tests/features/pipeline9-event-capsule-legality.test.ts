import { expect, test } from "bun:test"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { createClearanceCorridorSearch } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createClearanceCorridorSearch"
import type { RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("oriented scanline contraction preserves exact capsule clearance across deterministic geometries", (): void => {
  let seed = 73451
  const random = (): number => {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0
    return (seed >>> 0) / 0x100000000
  }
  for (let sample = 0; sample < 32; sample++) {
    const barriers = Array.from({ length: 4 }, () => {
      const a = { x: 1 + 2 * random(), y: 1 + 2 * random(), z: 0 }
      const b = { x: 1 + 2 * random(), y: 1 + 2 * random(), z: 0 }
      const radius = 0.05 + 0.1 * random()
      return { a, b, radius, minX: Math.min(a.x, b.x) - radius, maxX: Math.max(a.x, b.x) + radius,
        minY: Math.min(a.y, b.y) - radius, maxY: Math.max(a.y, b.y) + radius, minZ: 0, maxZ: 0 }
    })
    const start = { x: sample & 1 ? 3.75 : 0.25, y: sample & 2 ? 3.75 : 0.25, z: 0 }
    const end = { x: 4 - start.x, y: 4 - start.y, z: 0 }
    const clear = (a: RepairRoutePoint, b: RepairRoutePoint): boolean =>
      barriers.every((barrier) => segmentToSegmentMinDistance(a, b, barrier.a, barrier.b) >= barrier.radius + 0.1 - 1e-10)
    let output: RepairRoutePoint[] | null | undefined
    const search = createClearanceCorridorSearch({
      bounds: { minX: 0, maxX: 4, minY: 0, maxY: 4 }, start, end,
      barriers, additionalCostSupports: [], grid: 0.5, layerCount: 1,
      traceThickness: 0.1, wireReach: 0.1, viaReach: 0.2, drillSpacing: 0.4,
      allowLayerChanges: false, maxNodes: 5000, heuristicWeight: 3,
      clear, extraCost: (): number => 0, finish: (path): void => { output = path },
    })
    for (let step = 0; step < 10000 && output === undefined; step++) search.step()
    expect(output).toBeDefined()
    expect(output).not.toBeNull()
    expect(output![0]).toEqual(start)
    expect(output!.at(-1)).toEqual(end)
    expect(output!.slice(1).every((point, i) => clear(output![i]!, point))).toBe(true)
  }
})
