import { expect, test } from "bun:test"
import { ElectricalTreeTinyHyperGraphSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/ElectricalTreeTinyHyperGraphSolver"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"

test("electrical tree targets preserve direct hops and trim a prefix that meets its reused suffix early", () => {
  for (const directRegion of [true, false]) {
    const incident = directRegion
      ? [[0], [0, 1], [1], [0]]
      : [[0], [0, 1], [1], [2], [0, 2]]
    const topology: TinyHyperGraphTopology = {
      portCount: incident.length,
      regionCount: directRegion ? 2 : 3,
      regionIncidentPorts: directRegion
        ? [[0, 1, 3], [1, 2]]
        : [[0, 1, 4], [1, 2], [3, 4]],
      incidentPortRegion: incident,
      regionWidth: new Float64Array([10, 10, 1]),
      regionHeight: new Float64Array([10, 10, 1]),
      regionCenterX: new Float64Array([5, 15, 19]),
      regionCenterY: new Float64Array([0, 0, 1]),
      regionAvailableZMask: new Int32Array([1, 1, 1]),
      portAngleForRegion1: new Int32Array([18000, 0, 0, 9000, 9000]),
      portAngleForRegion2: new Int32Array([0, 18000, 0, 0, 18000]),
      portX: new Float64Array([0, 10, 20, 19, 18]),
      portY: new Float64Array([0, 0, 0, 1, 1]),
      portZ: new Int32Array(incident.length),
    }
    const problem: TinyHyperGraphProblem = {
      routeCount: 2,
      portSectionMask: new Int8Array(incident.length).fill(1),
      routeStartPort: new Int32Array([0, 3]),
      routeEndPort: new Int32Array([2, 0]),
      routeNet: new Int32Array([0, 0]),
      regionNetId: new Int32Array(topology.regionCount).fill(-1),
    }
    const solver = new ElectricalTreeTinyHyperGraphSolver(topology, problem, {
      RIP_THRESHOLD_START: 1,
      RIP_THRESHOLD_END: 1,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
      PARTIAL_RIP_ENABLED: false,
      OUTSIDE_IN_ROUTING: false,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    const routeSegments = solver.state.regionSegments.flat().filter(([owner]) => owner === 1)
    expect(routeSegments.some(([, from, to]) => from === 2 || to === 2)).toBe(false)
    if (directRegion) {
      expect(routeSegments).toEqual([[1, 3, 0]])
      expect(solver.stats.electricalTreeTargetCount).toBe(0)
    } else {
      expect(routeSegments).toHaveLength(3)
      expect(routeSegments).toContainEqual([1, 1, 0])
      expect(solver.stats.electricalTreeRemovedRetracedSegmentCount).toBe(2)
      expect(solver.stats.electricalTreeSuffixSegmentCount).toBe(1)
    }
  }
})
