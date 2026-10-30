import { expect, test } from "bun:test"
import { WarmStartedPreparedPortPointRoutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/WarmStartedPreparedPortPointRoutingSolver"

test("warm route assignments apply initially but are not restored on a global rerip", (): void => {
  const topology = {
    portCount: 2, regionCount: 1,
    regionIncidentPorts: [[0, 1]], incidentPortRegion: [[0], [0]],
    regionWidth: new Float64Array([2]), regionHeight: new Float64Array([2]),
    regionCenterX: new Float64Array([0]), regionCenterY: new Float64Array([0]),
    regionAvailableZMask: new Int32Array([1]),
    portAngleForRegion1: new Int32Array([0, 18000]), portAngleForRegion2: new Int32Array([0, 18000]),
    portX: new Float64Array([-1, 1]), portY: new Float64Array([0, 0]), portZ: new Int32Array([0, 0]),
  }
  const problem = {
    routeCount: 1,
    routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([0]), portSectionMask: new Int8Array([1, 1]),
    regionNetId: new Int32Array([-1]),
    initialAssignments: [{ routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 }],
  }
  const solver = new WarmStartedPreparedPortPointRoutingSolver(topology, problem)
  expect(solver.state.regionSegments[0]).toEqual([[0, 0, 1]])
  expect(solver.state.unroutedRoutes).toEqual([])
  expect(solver.problem.initialAssignments).toBeUndefined()
  solver.resetRoutingStateForRerip()
  expect(solver.state.regionSegments[0]).toEqual([])
  expect(solver.state.unroutedRoutes).toEqual([0])
})
