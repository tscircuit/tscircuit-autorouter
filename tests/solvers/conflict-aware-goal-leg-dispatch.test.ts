import { expect, test } from "bun:test"
import { ConflictAwareTinyHyperGraphSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/conflict-aware-tiny-hyper-graph-solver"
import { IndexedCandidateHeap } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/indexed-candidate-heap"
import type {
  Candidate,
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"

test("conflict-aware routing queues and commits the explicit terminal candidate", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 1,
    regionIncidentPorts: [[0, 1]],
    incidentPortRegion: [[0], [0]],
    regionWidth: new Float64Array([10]),
    regionHeight: new Float64Array([10]),
    regionCenterX: new Float64Array([1.5]),
    regionCenterY: new Float64Array([2]),
    regionAvailableZMask: new Int32Array([1]),
    portAngleForRegion1: new Int32Array([18000, 0]),
    portAngleForRegion2: new Int32Array([0, 0]),
    portX: new Float64Array([0, 3]),
    portY: new Float64Array([0, 4]),
    portZ: new Int32Array([0, 0]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 1]),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array([-1]),
    portPenalty: new Float64Array([0, 7]),
  }
  const solver = new ConflictAwareTinyHyperGraphSolver(topology, problem)

  solver.step()

  const queuedGoal = solver.state.candidateQueue.toArray()[0] as Candidate
  expect(solver.state.candidateQueue).toBeInstanceOf(IndexedCandidateHeap)
  expect(queuedGoal.portId).toBe(1)
  expect(queuedGoal.prevCandidate?.portId).toBe(0)
  expect(queuedGoal.g).toBeGreaterThanOrEqual(7 + 5 * solver.DISTANCE_TO_COST)
  expect(solver.state.currentRouteId).toBe(0)
  expect(solver.state.regionSegments[0]).toHaveLength(0)

  solver.step()

  expect(solver.state.currentRouteId).toBeUndefined()
  expect(solver.state.regionSegments[0]).toEqual([[0, 0, 1]])
  expect(solver.state.candidateQueue.length).toBe(0)

  solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
})
