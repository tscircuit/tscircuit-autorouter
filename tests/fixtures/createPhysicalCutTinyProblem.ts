import type { TinyHyperGraphProblem, TinyHyperGraphSolution, TinyHyperGraphTopology } from "tiny-hypergraph/lib/index"
import { createPhysicalCutTracker, type PhysicalCutTracker } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/pipeline9PhysicalCutResources"

export function createPhysicalCutTinyProblem(): { topology: TinyHyperGraphTopology; problem: TinyHyperGraphProblem; solution: TinyHyperGraphSolution; tracker: PhysicalCutTracker } {
  const tracker = createPhysicalCutTracker()
  const descriptor = { version: 1, problemId: tracker.id, cutId: "narrow-layer0", capacity: 1 }
  const topology: TinyHyperGraphTopology = {
    portCount: 4, regionCount: 4,
    regionIncidentPorts: [[2], [2, 0, 1], [0, 1, 3], [3]], incidentPortRegion: [[1, 2], [1, 2], [0, 1], [2, 3]],
    regionWidth: Float64Array.from([0.01, 2, 2, 0.01]), regionHeight: Float64Array.from([0.01, 0.1, 0.1, 0.01]),
    regionCenterX: Float64Array.from([-2, -1, 1, 2]), regionCenterY: new Float64Array(4), regionAvailableZMask: Int32Array.from([1, 1, 1, 1]),
    portAngleForRegion1: Int32Array.from([0, 0, 0, 0]), portAngleForRegion2: Int32Array.from([18000, 18000, 18000, 18000]),
    portX: Float64Array.from([0, 0, -2, 2]), portY: Float64Array.from([-0.025, 0.025, 0, 0]), portZ: new Int32Array(4),
    portMetadata: [{ __pipeline9PhysicalCut: descriptor }, { __pipeline9PhysicalCut: descriptor }, {}, {}],
  }
  const problem: TinyHyperGraphProblem = { routeCount: 1, routeStartPort: Int32Array.from([2]), routeEndPort: Int32Array.from([3]), routeNet: Int32Array.from([0]), regionNetId: new Int32Array(4).fill(-1), portSectionMask: new Int8Array(4).fill(1) }
  const solution: TinyHyperGraphSolution = { solvedRoutePathSegments: [[[2, 0], [0, 3]]], solvedRoutePathRegionIds: [[1, 2]] }
  return { topology, problem, solution, tracker }
}
