import { expect, test } from "bun:test"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { createClearanceCorridorSearch, getClearanceCapsuleSupportOrientation, type ClearanceCorridorStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createClearanceCorridorSearch"
import type { RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("oriented copper events expose free runs hidden by a diagonal trace bounding box", (): void => {
  const copperStart = { x: 0, y: 10 }, copperEnd = { x: 10, y: 0 }
  const radius = 0.1
  const extraCost = (a: RepairRoutePoint, b: RepairRoutePoint): number => {
    if (a.z === 1 && b.z === 1) return 0
    return segmentToSegmentMinDistance(a, b, copperStart, copperEnd) < radius ? Infinity : 0
  }
  let output: RepairRoutePoint[] | null | undefined
  let stats: ClearanceCorridorStats | undefined
  const input: Parameters<typeof createClearanceCorridorSearch>[0] = {
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 2 },
    start: { x: 0.25, y: 0.25, z: 0 }, end: { x: 9.75, y: 0.25, z: 1 },
    grid: 0.5, layerCount: 2, wireReach: 0.1, viaReach: 0.2, drillSpacing: 0.4, traceThickness: 0.1,
    allowLayerChanges: true, maxNodes: 30000, heuristicWeight: 3,
    barriers: [], additionalCostSupports: [{ minX: -radius, maxX: 10 + radius, minY: -radius, maxY: 10 + radius,
      minZ: 0, maxZ: 0, orientation: getClearanceCapsuleSupportOrientation(copperStart, copperEnd, radius) }],
    clear: (): boolean => true, extraCost,
    finish: (path, nodes, reason, edges, work): void => { output = path; stats = work; expect(reason).toBe("found") },
  }
  const search = createClearanceCorridorSearch(input)
  for (let step = 0; step < 10000 && output === undefined; step++) search.step()
  expect(output).toBeDefined()
  expect(output).not.toBeNull()
  expect(output!.slice(1).every((point, i) => Number.isFinite(extraCost(output![i]!, point)))).toBe(true)
  const via = output!.find((point, i) => i > 0 && point.z !== output![i - 1]!.z)!
  let reference: RepairRoutePoint[] | null | undefined
  const boxed = createClearanceCorridorSearch({ ...input,
    additionalCostSupports: input.additionalCostSupports.map(({ orientation, ...box }) => box),
    finish: (path): void => { reference = path },
  })
  for (let step = 0; step < 10000 && reference === undefined; step++) boxed.step()
  expect(reference).toBeDefined()
  expect(reference).not.toBeNull()
  const boxVia = reference!.find((point, i) => i > 0 && point.z !== reference![i - 1]!.z)!
  expect(via.x).toBeGreaterThan(boxVia.x)
  expect(stats!.corridorExpandedRunSteps).toBeGreaterThan(12)
  expect(stats!.corridorOrientedIntervalChecks).toBeGreaterThan(0)
  expect(stats!.corridorOrientedSupports).toBe(1)
})
