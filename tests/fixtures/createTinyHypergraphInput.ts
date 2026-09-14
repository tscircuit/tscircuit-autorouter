import type {
  TinyHyperGraphTopology,
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
} from "../../rust/tiny-hypergraph-bindings/ts"

export function createTinyHypergraphInput(): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
} {
  return {
    topology: {
      portCount: 2,
      regionCount: 3,
      regionIncidentPorts: [[0], [0, 1], [1]],
      incidentPortRegion: [
        [1, 0],
        [1, 2],
      ],
      regionWidth: new Float64Array([1, 2, 1]),
      regionHeight: new Float64Array([1, 2, 1]),
      regionCenterX: new Float64Array([-2, 0, 2]),
      regionCenterY: new Float64Array([0, 0, 0]),
      regionAvailableZMask: new Int32Array([1, 1, 1]),
      regionMetadata: [
        { serializedRegionId: "start" },
        { serializedRegionId: "middle" },
        { serializedRegionId: "end" },
      ],
      portAngleForRegion1: new Int32Array([18000, 0]),
      portAngleForRegion2: new Int32Array([0, 18000]),
      portX: new Float64Array([-1, 1]),
      portY: new Float64Array([0, 0]),
      portZ: new Int32Array([0, 0]),
      portMetadata: [
        { serializedPortId: "p0", customMetadata: { name: "retained" } },
        { serializedPortId: "p1" },
      ],
    },
    problem: {
      routeCount: 1,
      portSectionMask: new Int8Array([1, 1]),
      routeStartPort: new Int32Array([0]),
      routeEndPort: new Int32Array([1]),
      routeNet: new Int32Array([0]),
      regionNetId: new Int32Array([-1, -1, -1]),
      routeMetadata: [
        {
          connectionId: "route-0",
          mutuallyConnectedNetworkId: "net-0",
          startRegionId: "start",
          endRegionId: "end",
          customMetadata: { name: "retained" },
        },
      ],
    },
    options: { MAX_ITERATIONS: 100, RIP_THRESHOLD_END: 0.8 },
  }
}
