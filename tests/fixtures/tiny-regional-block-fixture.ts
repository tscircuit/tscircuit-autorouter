import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import { IndexedCandidateHeap } from "tiny-hypergraph/lib/indexed-candidate-heap"
import type { TinyHyperGraphTopology, TinyHyperGraphProblem, TinyHyperGraphSolver, Candidate } from "tiny-hypergraph/lib/core"

export type RegionalBlockHost = Omit<TinyHyperGraphSolver, never> & {
  ADD_SEGMENT_DISTANCE_TO_G: boolean
  getRegionalHopFrontier(region: number, neighbors: number[]): { neighbors: number[]; next: Int32Array; head: number }
  expandRegionalHopFrontier(candidate: Candidate, frontier: { neighbors: number[]; next: Int32Array; head: number }): void
}

export function createTinyRegionalBlockFixture(seed = 1): RegionalBlockHost {
  const ports = 65
  const neighbors = Array.from({ length: ports }, (_, i) => i)
  const topology: TinyHyperGraphTopology = {
    portCount: ports, regionCount: 2,
    regionIncidentPorts: [neighbors, [...neighbors]],
    incidentPortRegion: Array.from({ length: ports }, () => [0, 1]),
    regionWidth: new Float64Array([200, 200]), regionHeight: new Float64Array([200, 200]),
    regionCenterX: new Float64Array(2), regionCenterY: new Float64Array(2),
    regionAvailableZMask: new Int32Array([3, 3]),
    portAngleForRegion1: Int32Array.from(neighbors, i => i * 100),
    portAngleForRegion2: Int32Array.from(neighbors, i => i * 100),
    portX: Float64Array.from(neighbors, i => i === 0 ? 0 : 100 + ((i * 13 + seed) % 41)),
    portY: Float64Array.from(neighbors, i => ((i * 7 + seed) % 13) - 6),
    portZ: Int32Array.from(neighbors, i => i % 2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1, portSectionMask: new Int8Array(ports).fill(1),
    routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([64]),
    routeNet: new Int32Array([0]), regionNetId: new Int32Array([-1, -1]),
    portPenalty: new Float64Array(ports),
  }
  const solver = new DistanceAwareTinyHyperGraphSolver(topology, problem, { STATIC_REACHABILITY_PRECHECK: false, OWNED_REGIONAL_HOP_FRONTIER: true }) as unknown as RegionalBlockHost
  solver.state.candidateQueue = new IndexedCandidateHeap(2, { hopCapacity: ports * 2, hopSlotStride: 2, firstRegionByPortId: new Int32Array(ports), secondRegionByPortId: new Int32Array(ports).fill(1), incidentPortRegion: topology.incidentPortRegion })
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  solver.state.goalPortId = 64
  solver.state.portAssignment[64] = 1
  for (const port of neighbors) solver.setCandidateBestCost(solver.getHopId(port, 1), 2)
  return solver
}
