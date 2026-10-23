import { expect, test } from "bun:test"
import { createSparseClearanceEventSearch } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createSparseClearanceEventSearch"
import { createClearanceCorridorSearch, type CorridorSearchInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createClearanceCorridorSearch"
import type { RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("finite event callback-policy coverage can miss an interior via window found by the historical grid oracle", (): void => {
  const start = { x: 0.25, y: 0.25, z: 0 }, end = { x: 99.75, y: 0.25, z: 0 }
  // This custom callback exposes via windows not encoded in the barriers. It
  // demonstrates finite callback-policy coverage, not a complete production
  // obstacle-geometry counterexample.
  const clear = (a: RepairRoutePoint, b: RepairRoutePoint): boolean => a.z !== b.z
    ? a.x === 20.25 && a.y === 4.25 || a.x === 79.75 && a.y === 4.25
    : a.z === 1 || Math.max(a.x, b.x) < 40 || Math.min(a.x, b.x) > 60
  const witness = [start, { x: 20.25, y: 4.25, z: 0 }, { x: 20.25, y: 4.25, z: 1 },
    { x: 79.75, y: 4.25, z: 1 }, { x: 79.75, y: 4.25, z: 0 }, end]
  expect(witness.slice(1).every((point, i) => clear(witness[i]!, point))).toBe(true)
  const outcomes: Array<RepairRoutePoint[] | null | undefined> = []
  for (const [mode, create] of [createSparseClearanceEventSearch, createClearanceCorridorSearch].entries()) {
    const input: CorridorSearchInput = {
      bounds: { minX: 0, maxX: 100, minY: 0, maxY: 10 }, start, end,
      barriers: [{ minX: 40, maxX: 60, minY: 0, maxY: 10, minZ: 0, maxZ: 0 }], additionalCostSupports: [],
      grid: 0.5, layerCount: 2, wireReach: 0.05, viaReach: 0.2, traceThickness: 0.1, drillSpacing: 0.4,
      allowLayerChanges: true, maxNodes: 30000, heuristicWeight: 3, clear, extraCost: (): number => 0,
      finish: (path): void => { outcomes[mode] = path },
    }
    const search = create(input)
    for (let step = 0; step < 1_000_000 && outcomes[mode] === undefined; step++) search.step()
    expect(outcomes[mode]).toBeDefined()
  }
  expect(outcomes[0]).toBeNull()
  expect(outcomes[1]).not.toBeNull()
  expect(outcomes[1]!.slice(1).every((point, i) => clear(outcomes[1]![i]!, point))).toBe(true)
})
