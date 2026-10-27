import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"

export function createPreparedRoutingFixture(): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
} {
  const regions: number[][] = [],
    incident: number[][] = [],
    xs: number[] = [],
    ys: number[] = [],
    zs: number[] = []
  const starts: number[] = [],
    ends: number[] = []
  const centers: number[] = []
  const addPort = (
    x: number,
    y: number,
    z: number,
    regionIds: number[],
  ): number => {
    const id = xs.length
    xs.push(x)
    ys.push(y)
    zs.push(z)
    incident.push(regionIds)
    for (const region of regionIds) regions[region]!.push(id)
    return id
  }
  for (let module = 0; module < 4; module++) {
    const base = regions.length,
      x = module * 10
    regions.push([], [], [])
    centers.push(x, x + 2, x + 4)
    starts.push(addPort(x - 1, -0.6, 0, [base]), addPort(x - 1, 0.6, 0, [base]))
    for (let boundary = 0; boundary < 2; boundary++) {
      for (let index = 0; index < 4; index++)
        addPort(x + 1 + 2 * boundary, -0.6 + 0.4 * index, index % 2, [
          base + boundary,
          base + boundary + 1,
        ])
    }
    ends.push(
      addPort(x + 5, 0.6, 0, [base + 2]),
      addPort(x + 5, -0.6, 0, [base + 2]),
    )
  }
  const angle = (port: number, slot: number): number =>
    Math.round(
      (Math.atan2(ys[port]!, xs[port]! - centers[incident[port]![slot]!]!) *
        18000) /
        Math.PI,
    )
  return {
    topology: {
      portCount: xs.length,
      regionCount: regions.length,
      regionIncidentPorts: regions,
      incidentPortRegion: incident,
      regionWidth: new Float64Array(regions.length).fill(2),
      regionHeight: new Float64Array(regions.length).fill(2),
      regionCenterX: Float64Array.from(centers),
      regionCenterY: new Float64Array(regions.length),
      regionAvailableZMask: new Int32Array(regions.length).fill(3),
      portAngleForRegion1: Int32Array.from(xs, (_, port) => angle(port, 0)),
      portAngleForRegion2: Int32Array.from(xs, (_, port) =>
        incident[port]!.length > 1 ? angle(port, 1) : angle(port, 0),
      ),
      portX: Float64Array.from(xs),
      portY: Float64Array.from(ys),
      portZ: Int32Array.from(zs),
    },
    problem: {
      routeCount: starts.length,
      routeStartPort: Int32Array.from(starts),
      routeEndPort: Int32Array.from(ends),
      routeNet: Int32Array.from(starts, (_, route) => route),
      portSectionMask: new Int8Array(xs.length).fill(1),
      regionNetId: new Int32Array(regions.length).fill(-1),
    },
    options: {
      MAX_ITERATIONS: 50_000,
      OWNED_REGIONAL_HOP_FRONTIER: true,
      USE_SPARSE_CANDIDATE_STORAGE: false,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
      PARTIAL_RIP_ENABLED: false,
      OUTSIDE_IN_ROUTING: false,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
    },
  }
}
