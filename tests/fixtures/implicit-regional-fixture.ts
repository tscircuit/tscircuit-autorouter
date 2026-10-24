import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import type { TinyHyperGraphTopology, TinyHyperGraphProblem, TinyHyperGraphSolver, Candidate } from "tiny-hypergraph/lib/core"

export type ImplicitFixture = Omit<TinyHyperGraphSolver, never> & {
  getRegionalHopFrontier(region: number, neighbors: number[]): { neighbors: number[]; next: Int32Array; head: number }
  expandRegionalHopFrontier(candidate: Candidate, frontier: { neighbors: number[]; next: Int32Array; head: number }): void
}

export function createImplicitFixture(seed = 1, layers = [0, 1]): ImplicitFixture {
  const ports = 66
  const neighbors = Array.from({ length: 65 }, (_, i): number => i)
  const topology: TinyHyperGraphTopology = {
    portCount: ports, regionCount: 3,
    regionIncidentPorts: [neighbors, [...neighbors, 65], [65]],
    incidentPortRegion: Array.from({ length: ports }, (_, i): number[] => i === 65 ? [1, 2] : [0, 1]),
    regionWidth: new Float64Array([200, 200, 200]), regionHeight: new Float64Array([200, 200, 200]),
    regionCenterX: new Float64Array(3), regionCenterY: new Float64Array(3),
    regionAvailableZMask: new Int32Array([3, 3, 3]),
    portAngleForRegion1: Int32Array.from({ length: ports }, (_, i): number => (i * 79 + seed * 17) % 360),
    portAngleForRegion2: Int32Array.from({ length: ports }, (_, i): number => (i * 79 + seed * 17) % 360),
    portX: Float64Array.from({ length: ports }, (_, i): number => ((i * 31 + seed * 7) % 127) / 5),
    portY: Float64Array.from({ length: ports }, (_, i): number => ((i * 41 + seed * 13) % 113) / 7),
    portZ: Int32Array.from({ length: ports }, (_, i): number => layers[i % layers.length]!),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1, portSectionMask: new Int8Array(ports).fill(1),
    routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([65]),
    routeNet: new Int32Array([0]), regionNetId: new Int32Array([-1, -1, -1]),
    portPenalty: Float64Array.from({ length: ports }, (_, i): number => i % 11 === 0 ? 0.17 : 0),
  }
  const solver = new DistanceAwareTinyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false, OWNED_REGIONAL_HOP_FRONTIER: true,
  }) as unknown as ImplicitFixture
  solver._setup()
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 1
  solver.appendSegmentToRegionCache(0, 11, 19)
  solver.appendSegmentToRegionCache(0, 3, 45)
  solver.state.currentRouteNetId = 0
  solver.state.goalPortId = 65
  return solver
}

export function expandImplicitFixture(solver: ImplicitFixture, candidate: Candidate): void {
  const region = candidate.nextRegionId
  const frontier = solver.getRegionalHopFrontier(region, solver.topology.regionIncidentPorts[region]!)
  solver.expandRegionalHopFrontier(candidate, frontier)
}

export function implicitSource(port: number, g: number, region = 0): Candidate {
  return { portId: port, nextRegionId: region, g, h: 0, f: g }
}
