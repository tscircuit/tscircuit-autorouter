import { expect, test } from "bun:test"
import { ElectricalTreeTinyHyperGraphSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/ElectricalTreeTinyHyperGraphSolver"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"

test("physical alias traversal reaches copper across previously independent owners", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 9,
    regionCount: 4,
    regionIncidentPorts: [[0, 1, 7], [1, 2], [2, 3, 4, 5, 8], [6, 8]],
    incidentPortRegion: [[0], [0, 1], [1, 2], [2], [2], [2], [3], [0], [2, 3]],
    regionWidth: new Float64Array([10, 10, 30, 4]),
    regionHeight: new Float64Array([10, 10, 30, 4]),
    regionCenterX: new Float64Array([5, 15, 35, 32]),
    regionCenterY: new Float64Array([0, 0, 10, 27]),
    regionAvailableZMask: new Int32Array([1, 1, 1, 1]),
    portAngleForRegion1: new Int32Array([18000, 0, 0, 0, 9000, 0, 9000, 18000, 9000]),
    portAngleForRegion2: new Int32Array([0, 18000, 18000, 0, 0, 0, 0, 0, 27000]),
    portX: new Float64Array([0, 10, 20, 30, 40, 30, 32, 0, 32]),
    portY: new Float64Array([0, 0, 0, 0, 20, 0, 27, 0, 25]),
    portZ: new Int32Array(9),
    portMetadata: [
      { _tinyTerminal: true, pcb_port_id: "A" }, {}, {},
      { _tinyTerminal: true, pcb_port_id: "B" },
      { _tinyTerminal: true, pcb_port_id: "C" },
      { _tinyTerminal: true, pcb_port_id: "B" },
      { _tinyTerminal: true, pcb_port_id: "D" },
      { _tinyTerminal: true, pcb_port_id: "A" }, {},
    ],
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 3,
    portSectionMask: new Int8Array(9).fill(1),
    routeStartPort: new Int32Array([0, 4, 6]),
    routeEndPort: new Int32Array([3, 5, 7]),
    routeNet: new Int32Array([0, 0, 0]),
    regionNetId: new Int32Array(4).fill(-1),
  }
  const solver = new ElectricalTreeTinyHyperGraphSolver(topology, problem, {
    RIP_THRESHOLD_START: 1,
    RIP_THRESHOLD_END: 1,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false,
  })
  while (
    solver.state.unroutedRoutes.includes(1) || solver.state.currentRouteId === 1
  ) solver.step()
  expect(solver.state.regionSegments[2]).toContainEqual([1, 4, 5])
  expect(solver.stats.electricalTreeTargetCount).toBe(0)
  solver.step()
  expect(solver.state.currentRouteId).toBe(2)
  expect(solver.state.goalPortId).toBe(4)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.electricalTreeTargetCount).toBe(1)
  expect(solver.stats.electricalTreeSuffixSegmentCount).toBe(4)
  expect(solver.stats.electricalTreeAliasConnectorCount).toBe(2)
  const ownedSegments = solver.state.regionSegments.flat()
    .filter(([owner]) => owner === 2)
  const nextPort = new Map(ownedSegments.map(([, from, to]) => [from, to]))
  const path = [6]
  for (let index = 0; index < ownedSegments.length; index++) {
    const next = nextPort.get(path.at(-1)!)
    if (next === undefined) break
    path.push(next)
  }
  expect(path).toEqual([6, 8, 4, 5, 3, 2, 1, 0, 7])
  expect(ownedSegments).toHaveLength(path.length - 1)
  expect(problem.routeEndPort[2]).toBe(7)
})
