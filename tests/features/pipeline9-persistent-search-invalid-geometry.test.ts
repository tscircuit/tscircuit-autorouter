import { expect, test } from "bun:test"
import { PersistentClearanceSearch, PersistentClearanceSearchStore, type PersistentClearanceProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/PersistentClearanceSearch"

test("persistent search rejects invalid physical geometry and scene accounting", (): void => {
  const valid: PersistentClearanceProblem = {
    start: { x: 0, y: 0, z: 0 }, end: { x: 2, y: 2, z: 1 },
    bounds: { minX: 0, maxX: 3, minY: 0, maxY: 3 },
    grid: 0.1, layerCount: 2, traceThickness: 0.1,
    drillSpacing: 0.4, allowLayerChanges: true,
  }
  for (const invalid of [
    { ...valid, start: { ...valid.start, x: Number.NaN } },
    { ...valid, end: { ...valid.end, z: 0.5 } },
    { ...valid, start: { ...valid.start, z: 2 } },
    { ...valid, bounds: { ...valid.bounds, minX: Infinity } },
    { ...valid, bounds: { ...valid.bounds, maxY: -1 } },
    { ...valid, grid: 0 },
    { ...valid, grid: Infinity },
    { ...valid, layerCount: 0 },
    { ...valid, traceThickness: 0 },
    { ...valid, drillSpacing: -1 },
    { ...valid, heuristicWeight: Infinity },
    { ...valid, heuristicWeight: 0 },
    { ...valid, dominanceWitnessLimit: 33 },
    { ...valid, bounds: { minX: 1e16, maxX: 1e16 + 4, minY: 0, maxY: 3 } },
  ]) expect(() => new PersistentClearanceSearch(invalid)).toThrow()
  const search = new PersistentClearanceSearch(valid)
  const query = { revision: 0, changes: [], clear: (): boolean => true, extraCost: (): number => 0 }
  expect(() => search.begin({ ...query, revision: Number.NaN })).toThrow()
  expect(() => search.begin({ ...query, changes: [{ ...valid.bounds, minX: 4 }] })).toThrow()
  expect(() => search.configureBudget(0)).toThrow()
  expect(() => new PersistentClearanceSearchStore(0)).toThrow()
})
