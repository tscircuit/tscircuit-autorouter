import { expect, test } from "bun:test"
import { createClearanceCorridorSearch } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createClearanceCorridorSearch"
import type { RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("event grid points retain the searched nominal width while preserving terminal metadata", (): void => {
  const start = { x: 0.25, y: 0.25, z: 0, pcb_port_id: "start", traceThickness: 0.03 }
  const end = { x: 9.75, y: 0.25, z: 1, pcb_port_id: "end", traceThickness: 0.03 }
  let output: RepairRoutePoint[] | null | undefined
  const search = createClearanceCorridorSearch({
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 2 }, start, end,
    barriers: [], additionalCostSupports: [], grid: 0.5, layerCount: 2,
    traceThickness: 0.2, wireReach: 0.2, viaReach: 0.3, drillSpacing: 0.4,
    allowLayerChanges: true, maxNodes: 30000, heuristicWeight: 3,
    clear: (): boolean => true, extraCost: (): number => 0,
    finish: (path): void => { output = path },
  })
  for (let step = 0; step < 10000 && output === undefined; step++) search.step()
  expect(output).toBeDefined()
  expect(output).not.toBeNull()
  expect(output![0]).toEqual(start)
  expect(output!.at(-1)).toEqual(end)
  expect(output!.slice(1, -1).length).toBeGreaterThan(0)
  expect(output!.slice(1, -1).every((point) => point.traceThickness === 0.2)).toBe(true)
})
