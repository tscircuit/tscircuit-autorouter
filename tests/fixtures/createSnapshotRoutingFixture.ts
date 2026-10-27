import type { RoutingInput } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/snapshot/RouteProposalSolver"

export function createSnapshotRoutingFixture(): RoutingInput {
  // Ten independent routes require two eight-route waves, with a partial last wave.
  const routeCount = 10
  const portCount = routeCount * 2
  return {
    topology: {
      portCount,
      regionCount: routeCount,
      regionIncidentPorts: Array.from({length: routeCount}, (_, i) => [i * 2, i * 2 + 1]),
      incidentPortRegion: Array.from({length: portCount}, (_, i) => [Math.floor(i / 2)]),
      regionWidth: new Float64Array(routeCount).fill(2),
      regionHeight: new Float64Array(routeCount).fill(2),
      regionCenterX: Float64Array.from({length: routeCount}, (_, i) => i * 4),
      regionCenterY: new Float64Array(routeCount),
      regionAvailableZMask: new Int32Array(routeCount).fill(1),
      portAngleForRegion1: Int32Array.from({length: portCount}, (_, i) => i % 2 ? 0 : 18000),
      portX: Float64Array.from({length: portCount}, (_, i) => Math.floor(i / 2) * 4 + (i % 2 ? 1 : -1)),
      portY: new Float64Array(portCount),
      portZ: new Int32Array(portCount),
    },
    problem: {
      routeCount,
      portSectionMask: new Int8Array(portCount).fill(1),
      routeStartPort: Int32Array.from({length: routeCount}, (_, i) => i * 2),
      routeEndPort: Int32Array.from({length: routeCount}, (_, i) => i * 2 + 1),
      routeNet: Int32Array.from({length: routeCount}, (_, i) => i),
      regionNetId: new Int32Array(routeCount).fill(-1),
    },
    options: {MAX_ITERATIONS: 20_000},
  }
}
