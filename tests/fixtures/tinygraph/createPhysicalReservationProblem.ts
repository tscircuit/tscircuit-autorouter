import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"

export function createPhysicalReservationProblem(): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
} {
  const topology: TinyHyperGraphTopology = {
    portCount: 7,
    regionCount: 1,
    regionIncidentPorts: [[0, 1, 2, 3, 4, 5, 6]],
    incidentPortRegion: [[0], [0], [0], [0], [0], [0], [0]],
    regionWidth: new Float64Array([4]),
    regionHeight: new Float64Array([4]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    regionAvailableZMask: new Int32Array([3]),
    portAngleForRegion1: new Int32Array([18000, 0, 0, 0, 9000, 0, 0]),
    portX: new Float64Array([-1, 0, 1, 0, 0, 0.2, 0.199]),
    portY: new Float64Array([0, 0, 0, 0, 1, 0, 0]),
    portZ: new Int32Array([0, 0, 0, 1, 0, 0, 0]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    routeStartPort: new Int32Array([0, 4]),
    routeEndPort: new Int32Array([2, 4]),
    routeNet: new Int32Array([7, 11]),
    regionNetId: new Int32Array([-1]),
    portSectionMask: new Int8Array(7),
    routeMetadata: [
      { connectionId: "route-a", mutuallyConnectedNetworkId: "net-a" },
      { connectionId: "route-b", mutuallyConnectedNetworkId: "net-b" },
    ],
  }
  return { topology, problem }
}
