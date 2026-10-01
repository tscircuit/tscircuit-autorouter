import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { ShortFirstSelectiveReripTinyHyperGraphSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/ShortFirstSelectiveReripTinyHyperGraphSolver"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"

test("short-first preserves preloaded copper and the native global retry order", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 8,
    regionCount: 1,
    regionIncidentPorts: [[0, 1, 2, 3, 4, 5, 6, 7]],
    incidentPortRegion: Array.from({ length: 8 }, () => [0]),
    regionWidth: new Float64Array([30]),
    regionHeight: new Float64Array([30]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    portAngleForRegion1: new Int32Array(8),
    portX: new Float64Array([-4, 4, -4, -3, 8, 9, 20, 21]),
    portY: new Float64Array(8),
    portZ: new Int32Array(8),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 4,
    routeStartPort: new Int32Array([0, 2, 4, 6]),
    routeEndPort: new Int32Array([1, 3, 5, 7]),
    routeNet: new Int32Array([1, 1, 2, 3]),
    regionNetId: new Int32Array([-1]),
    portSectionMask: new Int8Array(8),
    initialAssignments: [
      { routeId: 3, regionId: 0, fromPortId: 6, toPortId: 7 },
    ],
  }
  const before = structuredClone(problem)
  const control =
    new SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments(
      topology,
      problem,
    )
  const candidate = new ShortFirstSelectiveReripTinyHyperGraphSolver(
    topology,
    problem,
  )
  expect(control.state.unroutedRoutes).toEqual([0, 1, 2])
  expect(candidate.state.unroutedRoutes).toEqual([2, 1, 0])
  expect(candidate.state.regionSegments).toEqual(control.state.regionSegments)
  expect(candidate.state.portAssignment).toEqual(control.state.portAssignment)
  expect(candidate.MAX_ITERATIONS).toBe(control.MAX_ITERATIONS)
  control.state.ripCount = 2
  candidate.state.ripCount = 2
  control.resetRoutingStateForRerip()
  candidate.resetRoutingStateForRerip()
  expect(candidate.state.unroutedRoutes).toEqual(control.state.unroutedRoutes)
  expect(candidate.state.regionSegments).toEqual(control.state.regionSegments)
  expect(candidate.state.portAssignment).toEqual(control.state.portAssignment)
  expect(candidate.state.unroutedRoutes).not.toContain(3)
  expect(problem).toEqual(before)
})
