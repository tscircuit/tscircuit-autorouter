import { expect, test } from "bun:test"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import { createClearanceCorridorSearch, type ClearanceCorridorStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createClearanceCorridorSearch"
import type { RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("cached support intervals preserve positive and negative axial and diagonal grid runs", (): void => {
  const stripe = { minX: 12.2, maxX: 12.8, minY: 0, maxY: 25 }
  const cases = [
    [{ x: 0.25, y: 3.25 }, { x: 24.75, y: 3.25 }],
    [{ x: 3.25, y: 0.25 }, { x: 3.25, y: 24.75 }],
    [{ x: 0.25, y: 0.25 }, { x: 24.75, y: 24.75 }],
    [{ x: 0.25, y: 24.75 }, { x: 24.75, y: 0.25 }],
  ] as const
  let cacheHits = 0, builds = 0
  for (const [left, right] of cases) for (const reverse of [false, true]) {
    const start = { ...(reverse ? right : left), z: 0 }
    const end = { ...(reverse ? left : right), z: 1 }
    const clear = (a: RepairRoutePoint, b: RepairRoutePoint): boolean =>
      a.z === 1 && b.z === 1 || segmentToBoundsMinDistance(a, b, stripe) >= 0.05
    let output: RepairRoutePoint[] | null | undefined
    let stats: ClearanceCorridorStats | undefined
    const search = createClearanceCorridorSearch({
      bounds: { minX: 0, maxX: 25, minY: 0, maxY: 25 }, start, end,
      barriers: [{ ...stripe, minZ: 0, maxZ: 0 }], additionalCostSupports: [],
      grid: 0.5, layerCount: 2, traceThickness: 0.1, wireReach: 0.05, viaReach: 0.2,
      drillSpacing: 0.4, allowLayerChanges: true, maxNodes: 30000, heuristicWeight: 3,
      clear, extraCost: (): number => 0,
      finish: (path, nodes, reason, edges, work): void => { output = path; stats = work; expect(reason).toBe("found") },
    })
    for (let step = 0; step < 100000 && output === undefined; step++) search.step()
    expect(output).toBeDefined()
    expect(output).not.toBeNull()
    expect(output![0]).toEqual(start)
    expect(output!.at(-1)).toEqual(end)
    expect(output!.slice(1).every((point, i) => clear(output![i]!, point))).toBe(true)
    expect(stats!.corridorExpandedRunSteps).toBeGreaterThan(10)
    expect(stats!.corridorMaintenanceLimitReached).toBe(0)
    cacheHits += stats!.corridorIntervalCacheHits
    builds += stats!.corridorIntervalBuilds
  }
  expect(cacheHits).toBeGreaterThan(0)
  expect(builds).toBeGreaterThan(0)
})
