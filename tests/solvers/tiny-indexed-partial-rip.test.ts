import { expect, test } from "bun:test"
import { OutsideInPartialRipTinyHyperGraphSolver as IndexedSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/tiny-hypergraph-fork/OutsideInPartialRipTinyHyperGraphSolver"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { OutsideInPartialRipTinyHyperGraphSolver as OriginalSolver } from "tiny-hypergraph/lib/outside-in-partial-rip-tiny-hypergraph-solver"

class OriginalHarness extends OriginalSolver {
  protected override getRouteIdsPreferredForPreservation(): ReadonlySet<number> {
    return new Set([0])
  }
  prepare(hotRegions: number[], costs: Float64Array): boolean {
    return this.preparePartialRip(hotRegions, costs)
  }
  getPlans(): ReadonlyMap<number, unknown> {
    return this.partialRipRoutePlans
  }
}

class IndexedHarness extends IndexedSolver {
  protected override getRouteIdsPreferredForPreservation(): ReadonlySet<number> {
    return new Set([0])
  }
  prepare(hotRegions: number[], costs: Float64Array): boolean {
    return this.preparePartialRip(hotRegions, costs)
  }
  getPlans(): ReadonlyMap<number, unknown> {
    return this.partialRipRoutePlans
  }
}

test("indexed partial rip preserves original traversal order, retained assignments, and early refusal", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 6, regionCount: 3,
    incidentPortRegion: [[1], [0, 1], [0, 2], [2], [0], [0]],
    regionIncidentPorts: [[1, 2, 4, 5], [0, 1], [2, 3]],
    regionWidth: new Float64Array([2, 2, 2]), regionHeight: new Float64Array([2, 2, 2]),
    regionCenterX: new Float64Array([1.5, 0.5, 2.5]), regionCenterY: new Float64Array(3),
    portX: new Float64Array([0, 1, 2, 3, 1, 2]), portY: new Float64Array([0, 0, 0, 0, 1, 1]),
    portZ: new Int32Array(6), portAngleForRegion1: new Int32Array([0, 100, 200, 300, 400, 500]),
  }
  const assignments = [
    { routeId: 0, regionId: 0, fromPortId: 1, toPortId: 2 },
    { routeId: 1, regionId: 0, fromPortId: 4, toPortId: 5 },
    { routeId: 0, regionId: 2, fromPortId: 2, toPortId: 3 },
    { routeId: 0, regionId: 1, fromPortId: 0, toPortId: 1 },
  ]
  const createProblem = (): TinyHyperGraphProblem => ({
    routeCount: 2, routeStartPort: new Int32Array([0, 4]), routeEndPort: new Int32Array([3, 5]),
    routeNet: new Int32Array([10, 20]), regionNetId: new Int32Array(3).fill(-1),
    portSectionMask: new Int8Array(6), initialAssignments: assignments,
  })
  const options = {
    PARTIAL_RIP_ENABLED: true, OUTSIDE_IN_ROUTING: true,
    PARTIAL_RIP_MAX_DISTANCE: 0, PARTIAL_RIP_QUALITY_MAX_DISTANCE: 0,
  }
  for (const incomplete of [false, true]) {
    const original = new OriginalHarness(topology, createProblem(), options)
    const indexed = new IndexedHarness(topology, createProblem(), options)
    if (incomplete) {
      original.state.regionSegments[2] = []
      indexed.state.regionSegments[2] = []
    }
    const costs = new Float64Array([2, 0.1, 0.1])
    const expected = original.prepare([0], costs)
    expect(indexed.prepare([0], costs)).toBe(expected)
    expect(expected).toBe(!incomplete)
    expect(indexed.state.regionSegments).toEqual(original.state.regionSegments)
    expect(indexed.state.regionIntersectionCaches).toEqual(original.state.regionIntersectionCaches)
    expect(indexed.state.portAssignment).toEqual(original.state.portAssignment)
    expect(indexed.state.unroutedRoutes).toEqual(original.state.unroutedRoutes)
    expect(indexed.getPlans()).toEqual(original.getPlans())
    expect(indexed.stats).toEqual(original.stats)
    expect(indexed.problem.initialAssignments).toBe(assignments)
    expect(indexed.problem.initialAssignments![0]).toBe(assignments[0])
    if (!incomplete) {
      expect(indexed.state.unroutedRoutes).toEqual([1])
      expect(indexed.state.regionSegments).toEqual([[[0, 1, 2]], [[0, 0, 1]], [[0, 2, 3]]])
      expect(indexed.stats.partialRipCount).toBe(1)
    }
  }
})
