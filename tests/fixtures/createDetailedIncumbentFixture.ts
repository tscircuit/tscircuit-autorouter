import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"

export function createDetailedIncumbentFixture(): { topology: TinyHyperGraphTopology; problem: TinyHyperGraphProblem } {
  const topology: TinyHyperGraphTopology = {
    portCount: 9, regionCount: 5,
    regionIncidentPorts: [[0, 1, 5], [1, 2], [5, 6], [2, 6, 4], [7, 8]],
    incidentPortRegion: [[0], [0, 1], [1, 3], [], [3], [0, 2], [2, 3], [4], [4]],
    regionWidth: new Float64Array([2, 2, 2, 2, 2]), regionHeight: new Float64Array([2, 2, 2, 2, 2]),
    regionCenterX: new Float64Array([-2, 0, 0, 2, 0]), regionCenterY: new Float64Array([0, 0, 1, 0, 4]),
    regionAvailableZMask: new Int32Array([3, 3, 3, 3, 3]),
    regionMetadata: ["start", "conflict", "detour", "end", "physical"].map((id) => ({ capacityMeshNodeId: id, serializedRegionId: id })),
    portMetadata: Array.from({ length: 9 }, (_, index) => ({ serializedPortId: `port-${index}` })),
    portAngleForRegion1: new Int32Array([18000, 0, 0, 0, 0, 3000, 33000, 18000, 0]),
    portAngleForRegion2: new Int32Array([0, 18000, 18000, 0, 0, 18000, 15000, 0, 0]),
    portX: new Float64Array([-3, -1, 1, 0, 3, -1, 1, -1, 1]),
    portY: new Float64Array([0, 0, 0, 0, 0, 1, 1, 4, 4]), portZ: new Int32Array(9),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2, routeStartPort: new Int32Array([0, 7]), routeEndPort: new Int32Array([4, 8]),
    routeNet: new Int32Array([0, 1]), regionNetId: new Int32Array(5).fill(-1),
    portSectionMask: new Int8Array(9).fill(1), routeMetadata: [{ connectionId: "a" }, { connectionId: "physical" }],
    initialAssignments: [{ routeId: 1, regionId: 4, fromPortId: 7, toPortId: 8 }],
  }
  return { topology, problem }
}
