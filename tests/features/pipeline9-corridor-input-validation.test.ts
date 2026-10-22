import { expect, test } from "bun:test"
import { createClearanceCorridorSearch } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createClearanceCorridorSearch"

test("clearance corridor graph rejects malformed geometry before constructing search state", (): void => {
  const input = {
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    start: { x: -0.5, y: 0, z: 0 }, end: { x: 0.5, y: 0, z: 0 },
    barriers: [], layerCount: 2, wireReach: 0.15, viaReach: 0.25,
    allowLayerChanges: true, maxNodes: 100, heuristicWeight: 1,
    clear: (): boolean => true, extraCost: (): number => 0,
    clearsDrills: (): boolean => true, finish: (): void => {},
  }
  expect(() => createClearanceCorridorSearch({ ...input, start: { ...input.start, x: NaN } })).toThrow("finite")
  expect(() => createClearanceCorridorSearch({ ...input, bounds: { ...input.bounds, minX: 1 } })).toThrow("positive area")
  expect(() => createClearanceCorridorSearch({ ...input, end: { ...input.end, z: 2 } })).toThrow("copper layers")
  expect(() => createClearanceCorridorSearch({ ...input, barriers: [{ minX: NaN, maxX: 1, minY: 0, maxY: 1 }] })).toThrow("ordered bounds")
  expect(() => createClearanceCorridorSearch({ ...input, maxNodes: 0 })).toThrow("work limits")
})
