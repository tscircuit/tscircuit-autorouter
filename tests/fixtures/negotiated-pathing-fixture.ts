import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"

export function negotiatedPathingFixture(): { topology: TinyHyperGraphTopology; problem: TinyHyperGraphProblem } {
  return {
    topology: {
      portCount: 6, regionCount: 2,
      incidentPortRegion: [[0], [0, 1], [1], [0], [0, 1], [1]],
      regionIncidentPorts: [[0, 1, 3, 4], [1, 2, 4, 5]],
      regionWidth: new Float64Array([4, 4]), regionHeight: new Float64Array([4, 4]),
      regionCenterX: new Float64Array([1, 3]), regionCenterY: new Float64Array([2, 2]),
      portX: new Float64Array([0, 2, 4, 0, 2, 4]),
      portY: new Float64Array([0, 0, 0, 0.1, 4, 0.1]),
      portZ: new Int32Array(6),
      portAngleForRegion1: new Int32Array([22500, 31500, 31500, 22600, 4500, 31600]),
      portAngleForRegion2: new Int32Array([0, 22500, 0, 0, 13500, 0]),
      regionAvailableZMask: new Int32Array([3, 3]),
    },
    problem: {
      routeCount: 2, routeStartPort: new Int32Array([0, 3]), routeEndPort: new Int32Array([2, 5]),
      routeNet: new Int32Array([10, 20]), regionNetId: new Int32Array(2).fill(-1),
      portSectionMask: new Int8Array(6).fill(1),
    },
  }
}
