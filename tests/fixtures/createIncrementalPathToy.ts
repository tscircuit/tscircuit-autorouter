import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"

export function createIncrementalPathToy(): { topology: TinyHyperGraphTopology; problem: TinyHyperGraphProblem } {
  const xs = [0, 1, 1, 3, 3, 4], ys = [0, -1, 1, -1, 1, 0]
  const regions = [[0, 1, 2], [1, 3], [2, 4], [3, 4, 5]]
  const incident = [[0], [0, 1], [0, 2], [1, 3], [2, 3], [3]]
  const centers = [[0.5, 0], [2, -1], [2, 1], [3.5, 0]]
  const angles = (slot: number): Int32Array => Int32Array.from(xs, (_, port) => {
    const region = incident[port]![slot] ?? incident[port]![0]!
    return Math.round(Math.atan2(ys[port]! - centers[region]![1]!, xs[port]! - centers[region]![0]!) * 18000 / Math.PI)
  })
  return {
    topology: { portCount: 6, regionCount: 4, regionIncidentPorts: regions, incidentPortRegion: incident,
      regionWidth: new Float64Array(4).fill(4), regionHeight: new Float64Array(4).fill(4),
      regionCenterX: Float64Array.from(centers, (point) => point[0]!), regionCenterY: Float64Array.from(centers, (point) => point[1]!),
      regionAvailableZMask: new Int32Array(4).fill(3), portAngleForRegion1: angles(0), portAngleForRegion2: angles(1),
      portX: Float64Array.from(xs), portY: Float64Array.from(ys), portZ: new Int32Array(6) },
    problem: { routeCount: 1, routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([5]), routeNet: new Int32Array([0]),
      portSectionMask: new Int8Array(6).fill(1), regionNetId: new Int32Array(4).fill(-1), portPenalty: new Float64Array(6) },
  }
}
