import { expect, test } from "bun:test"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import { PersistentClearanceSearch, type PersistentClearanceProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/PersistentClearanceSearch"
import type { Bounds, RepairRoutePoint } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/repairRegionTypes"

test("persistent shortest-path labels and frontier repair obstacle and congestion changes", (): void => {
  const problem: PersistentClearanceProblem = {
    start: { x: 0.1, y: 2.1, z: 0, pcb_port_id: "start" },
    end: { x: 3.9, y: 2.1, z: 0, pcb_port_id: "end" },
    bounds: { minX: 0, maxX: 4, minY: 0, maxY: 4 },
    grid: 0.5, layerCount: 1, traceThickness: 0.1,
    drillSpacing: 0.4, allowLayerChanges: false,
  }
  const search = new PersistentClearanceSearch(problem)
  let obstacles: Bounds[] = []
  let upperCost = 0
  const clear = (a: RepairRoutePoint, b: RepairRoutePoint): boolean =>
    obstacles.every((bounds) => segmentToBoundsMinDistance(a, b, bounds) >= 0.05)
  const extraCost = (a: RepairRoutePoint, b: RepairRoutePoint): number =>
    (a.y + b.y) / 2 > 2 ? Math.hypot(a.x - b.x, a.y - b.y) * upperCost : 0
  const mutations = [
    (): Bounds[] => [],
    (): Bounds[] => [],
    (): Bounds[] => {
      obstacles = [{ minX: 1.7, maxX: 2.3, minY: 1.2, maxY: 2.8 }]
      return [{ minX: 1.6, maxX: 2.4, minY: 1.1, maxY: 2.9 }]
    },
    (): Bounds[] => {
      upperCost = 5
      return [{ minX: 0, maxX: 4, minY: 2, maxY: 4 }]
    },
    (): Bounds[] => {
      upperCost = 0
      obstacles = [{ minX: 1.7, maxX: 2.3, minY: 0.2, maxY: 1.8 }]
      return [{ minX: 0, maxX: 4, minY: 0, maxY: 4 }]
    },
    (): Bounds[] => {
      obstacles = []
      return [{ minX: 1.6, maxX: 2.4, minY: 0.1, maxY: 1.9 }]
    },
  ]
  let invalidated = 0, changed = 0
  for (let revision = 0; revision < mutations.length; revision++) {
    const changes = mutations[revision]!()
    const query = { revision, changes, clear, extraCost }
    search.begin(query)
    let complete = false
    for (let batch = 0; batch < 2000 && !complete; batch++) complete = search.advance(128)
    expect(complete).toBe(true)
    const cold = new PersistentClearanceSearch(problem)
    cold.begin({ ...query, changes: [] })
    let coldComplete = false
    for (let batch = 0; batch < 2000 && !coldComplete; batch++) coldComplete = cold.advance(128)
    expect(coldComplete).toBe(true)
    expect(search.getSolutionCost()).toBeCloseTo(cold.getSolutionCost(), 9)
    const output = search.getOutput()!
    expect(output[0]).toEqual(problem.start)
    expect(output.at(-1)).toEqual(problem.end)
    expect(output.slice(1).every((point, index) => clear(output[index]!, point))).toBe(true)
    if (revision === 1) {
      expect(search.stats.reusedLabels).toBeGreaterThan(0)
      expect(search.stats.reusedFrontierEntries).toBeGreaterThan(0)
      expect(search.stats.nodesPopped).toBe(0)
      expect(search.stats.neighborGenerations).toBe(0)
    }
    invalidated += search.stats.invalidatedEdges
    changed += search.stats.changedEdges
  }
  expect(invalidated).toBeGreaterThan(0)
  expect(changed).toBeGreaterThan(0)
  expect(search.stats.retainedStates).toBeGreaterThan(0)
})
