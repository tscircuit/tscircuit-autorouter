import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import { IndexedCandidateHeap } from "tiny-hypergraph/lib/indexed-candidate-heap"
import type { TinyHyperGraphTopology, TinyHyperGraphProblem, TinyHyperGraphSolver, Candidate } from "tiny-hypergraph/lib/core"

export type GeometricHost = Omit<TinyHyperGraphSolver, never> & {
  ADD_SEGMENT_DISTANCE_TO_G: boolean
  getRegionalHopFrontier(region: number, neighbors: number[]): { neighbors: number[]; next: Int32Array; head: number }
  expandRegionalHopFrontier(candidate: Candidate, frontier: { neighbors: number[]; next: Int32Array; head: number }): void
}

export function createGeometricFixture(): GeometricHost {
  const ports = 66
  const neighbors = Array.from({ length: ports - 1 }, (_, i) => i)
  const topology: TinyHyperGraphTopology = {
    portCount: ports, regionCount: 3,
    regionIncidentPorts: [neighbors, [...neighbors, 65], [65]],
    incidentPortRegion: Array.from({ length: ports }, (_, i) => i === 65 ? [1, 2] : [0, 1]),
    regionWidth: new Float64Array([200, 200, 200]), regionHeight: new Float64Array([200, 200, 200]),
    regionCenterX: new Float64Array(3), regionCenterY: new Float64Array(3),
    regionAvailableZMask: new Int32Array([3, 3, 3]),
    portAngleForRegion1: Int32Array.from({ length: ports }, (_, i) => i * 100),
    portAngleForRegion2: Int32Array.from({ length: ports }, (_, i) => i * 100),
    portX: Float64Array.from({ length: ports }, (_, i) => i < 2 ? i * 0.1 : 10 + i / 10),
    portY: Float64Array.from({ length: ports }, (_, i) => i < 2 ? 0 : (i % 7) / 10),
    portZ: new Int32Array(ports),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1, portSectionMask: new Int8Array(ports).fill(1),
    routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([65]),
    routeNet: new Int32Array([0]), regionNetId: new Int32Array([-1, -1, -1]),
    portPenalty: new Float64Array(ports),
  }
  const solver = new DistanceAwareTinyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false, OWNED_REGIONAL_HOP_FRONTIER: true,
  }) as unknown as GeometricHost
  solver.state.candidateQueue = new IndexedCandidateHeap(3, {
    hopCapacity: ports * 2, hopSlotStride: 2,
    firstRegionByPortId: Int32Array.from({ length: ports }, (_, i) => i === 65 ? 1 : 0),
    secondRegionByPortId: Int32Array.from({ length: ports }, (_, i) => i === 65 ? 2 : 1),
    incidentPortRegion: topology.incidentPortRegion,
  })
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  solver.state.goalPortId = 65
  return solver
}

export function expandGeometric(solver: GeometricHost, candidate: Candidate): void {
  const region = candidate.nextRegionId
  const neighbors = solver.topology.regionIncidentPorts[region]!
  const frontier = solver.getRegionalHopFrontier(region, neighbors)
  solver.expandRegionalHopFrontier(candidate, frontier)
}

export function candidateAt(port: number, g: number, region = 0): Candidate {
  return {
    portId: port,
    nextRegionId: region,
    g, h: 0, f: g,
  }
}
