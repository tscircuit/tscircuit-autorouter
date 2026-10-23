import { expect, test } from "bun:test"
import { ElectricalTreeTinyHyperGraphSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/ElectricalTreeTinyHyperGraphSolver"
import {
  createEmptyRegionIntersectionCache,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"

class AliasOwnershipProbe extends ElectricalTreeTinyHyperGraphSolver {
  removeOwner(routeId: number): void {
    this.state.portAssignment.fill(-1)
    for (let regionId = 0; regionId < this.state.regionSegments.length; regionId++) {
      this.state.regionSegments[regionId] = this.state.regionSegments[regionId]!
        .filter(([owner]) => owner !== routeId)
      this.state.regionIntersectionCaches[regionId] = createEmptyRegionIntersectionCache()
      for (const [owner, from, to] of this.state.regionSegments[regionId]!) {
        this.state.portAssignment[from] = this.problem.routeNet[owner]!
        this.state.portAssignment[to] = this.problem.routeNet[owner]!
        this.appendSegmentToRegionCache(regionId, from, to)
      }
    }
  }
}

test("physical terminal aliases retain the original endpoint and reject uncertified copper", (): void => {
  for (const variant of [
    "same-pad", "different-pad", "not-terminal", "different-net",
    "different-layer", "different-position", "different-region",
    "preloaded-owner", "preloaded-metadata", "preloaded-port",
  ]) {
    const topology: TinyHyperGraphTopology = {
      portCount: 6,
      regionCount: 3,
      regionIncidentPorts: [[0, 1], [1, 2, 4], [2, 3, 5]],
      incidentPortRegion: [[0], [0, 1], [1, 2], [2], [1], [2]],
      regionWidth: new Float64Array([10, 10, 10]),
      regionHeight: new Float64Array([10, 10, 10]),
      regionCenterX: new Float64Array([5, 15, 25]),
      regionCenterY: new Float64Array(3),
      regionAvailableZMask: new Int32Array([3, 3, 3]),
      portAngleForRegion1: new Int32Array([18000, 0, 0, 0, 9000, 0]),
      portAngleForRegion2: new Int32Array([0, 18000, 18000, 0, 0, 0]),
      portX: new Float64Array([0, 10, 20, 30, 19, 30]),
      portY: new Float64Array([0, 0, 0, 0, 1, 0]),
      portZ: new Int32Array(6),
      portMetadata: [
        { _tinyTerminal: true, pcb_port_id: "start" }, {}, {},
        { _tinyTerminal: true, pcb_port_id: "shared-pad" },
        { _tinyTerminal: true, pcb_port_id: "branch" },
        { _tinyTerminal: true, pcb_port_id: "shared-pad" },
      ],
    }
    const problem: TinyHyperGraphProblem = {
      routeCount: 2,
      portSectionMask: new Int8Array(6).fill(1),
      routeStartPort: new Int32Array([0, 4]),
      routeEndPort: new Int32Array([3, 5]),
      routeNet: new Int32Array([0, 0]),
      regionNetId: new Int32Array(3).fill(-1),
    }
    if (variant === "different-pad") topology.portMetadata![5]!.pcb_port_id = "other-pad"
    if (variant === "not-terminal") topology.portMetadata![5]!._tinyTerminal = false
    if (variant === "different-layer") topology.portZ[5] = 1
    if (variant === "different-position") topology.portX[5] = 29.9
    if (variant === "preloaded-port") topology.portMetadata![3]!._preloadedFixedNetIds = ["bus"]
    if (variant === "different-net") {
      problem.routeCount = 3
      problem.routeStartPort = new Int32Array([0, 4, 4])
      problem.routeEndPort = new Int32Array([3, 5, 5])
      problem.routeNet = new Int32Array([0, 1, 1])
    }
    if (variant === "different-region") {
      topology.portCount = 7
      topology.regionCount = 4
      topology.regionIncidentPorts = [[0, 1], [1, 2, 4, 6], [2, 3], [5, 6]]
      topology.incidentPortRegion = [[0], [0, 1], [1, 2], [2], [1], [3], [1, 3]]
      topology.regionWidth = new Float64Array([10, 10, 10, 10])
      topology.regionHeight = new Float64Array([10, 10, 10, 10])
      topology.regionCenterX = new Float64Array([5, 15, 25, 25])
      topology.regionCenterY = new Float64Array(4)
      topology.regionAvailableZMask = new Int32Array([3, 3, 3, 3])
      topology.portAngleForRegion1 = new Int32Array([18000, 0, 0, 0, 9000, 0, 0])
      topology.portAngleForRegion2 = new Int32Array([0, 18000, 18000, 0, 0, 0, 18000])
      topology.portX = new Float64Array([0, 10, 20, 30, 19, 30, 20])
      topology.portY = new Float64Array([0, 0, 0, 0, 1, 0, 1])
      topology.portZ = new Int32Array(7)
      topology.portMetadata!.push({})
      problem.portSectionMask = new Int8Array(7).fill(1)
      problem.regionNetId = new Int32Array(4).fill(-1)
    }
    if (variant === "preloaded-owner") {
      problem.initialAssignments = [
        { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 },
        { routeId: 0, regionId: 1, fromPortId: 1, toPortId: 2 },
        { routeId: 0, regionId: 2, fromPortId: 2, toPortId: 3 },
      ]
    }
    if (variant === "preloaded-metadata") {
      problem.routeMetadata = [{
        connectionId: "preloaded",
        preloadedTraceSection: {
          traceId: "fixed", startRoutePosition: 0, endRoutePosition: 1,
          startPoint: { x: 0, y: 0, z: 0 },
          endPoint: { x: 30, y: 0, z: 0 },
        },
      }, {}]
    }
    const solver = new AliasOwnershipProbe(topology, problem, {
      RIP_THRESHOLD_START: 1, RIP_THRESHOLD_END: 1,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
      PARTIAL_RIP_ENABLED: false, OUTSIDE_IN_ROUTING: false,
    })
    if (variant !== "same-pad") {
      while (
        !solver.solved && !solver.failed &&
        (solver.state.unroutedRoutes.includes(0) || solver.state.currentRouteId === 0)
      ) solver.step()
      expect(solver.failed, variant).toBe(false)
      solver.step()
      expect(solver.state.currentRouteId, variant).toBe(1)
      expect(solver.state.goalPortId, variant).toBe(5)
      expect(solver.stats.electricalTreeTargetCount).toBe(0)
      expect(solver.stats.electricalTreeAliasConnectorCount).toBe(0)
      continue
    }
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.stats.electricalTreeTargetCount).toBe(1)
    expect(solver.stats.electricalTreeSuffixSegmentCount).toBe(1)
    expect(solver.stats.electricalTreeAliasConnectorCount).toBe(1)
    expect(solver.state.regionSegments[2]).toContainEqual([1, 3, 5])
    solver.removeOwner(0)
    expect(solver.state.regionSegments[1]).toEqual([[1, 4, 2]])
    expect(solver.state.regionSegments[2]).toEqual([[1, 2, 3], [1, 3, 5]])
    expect(problem.routeEndPort[1]).toBe(5)
    expect(topology.portMetadata![5]!.pcb_port_id).toBe("shared-pad")
  }
})
