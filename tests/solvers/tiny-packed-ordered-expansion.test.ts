import { expect, test } from "bun:test"
import type { Candidate, TinyHyperGraphProblem, TinyHyperGraphSolver, TinyHyperGraphSolverOptions, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import { PackedDistanceAwareTinyHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/PackedDistanceAwareTinyHyperGraphSolver"

type Trace = Array<Array<number | string | undefined>>

class OriginalHarness extends DistanceAwareTinyHyperGraphSolver {
  readonly trace: Trace = []

  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem,
    options: TinyHyperGraphSolverOptions, addDistance: boolean) {
    super(topology, problem, options)
    this.ADD_SEGMENT_DISTANCE_TO_G = addDistance
    this.state.regionCongestionCost.set([0.03125, 0.125, 0.125, 0.0625, 0.25])
  }

  override computeG(candidate: Candidate, neighbor: number, maxCost?: number, distance?: number): number {
    const result = super.computeG(candidate, neighbor, maxCost, distance)
    this.trace.push([
      "g", candidate.portId, neighbor, candidate.g,
      maxCost, distance, result,
    ])
    return result
  }

  override computeH(portId: number): number {
    const result = super.computeH(portId)
    this.trace.push([
      "h", portId,
      result,
    ])
    return result
  }

  override onPathFound(candidate: Candidate): void {
    this.trace.push([
      "goal", candidate.portId,
      candidate.nextRegionId, candidate.g,
    ])
    super.onPathFound(candidate)
  }
}

class PackedHarness extends PackedDistanceAwareTinyHyperGraphSolver {
  readonly trace: Trace = []

  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem,
    options: TinyHyperGraphSolverOptions, addDistance: boolean) {
    super(topology, problem, options)
    this.ADD_SEGMENT_DISTANCE_TO_G = addDistance
    this.state.regionCongestionCost.set([0.03125, 0.125, 0.125, 0.0625, 0.25])
  }

  override computeG(candidate: Candidate, neighbor: number, maxCost?: number, distance?: number): number {
    const result = super.computeG(candidate, neighbor, maxCost, distance)
    this.trace.push([
      "g", candidate.portId, neighbor, candidate.g,
      maxCost, distance, result,
    ])
    return result
  }

  override computeH(portId: number): number {
    const result = super.computeH(portId)
    this.trace.push([
      "h", portId,
      result,
    ])
    return result
  }

  override onPathFound(candidate: Candidate): void {
    this.trace.push([
      "goal", candidate.portId,
      candidate.nextRegionId, candidate.g,
    ])
    super.onPathFound(candidate)
  }
}

function createTopology(): TinyHyperGraphTopology {
  return {
    portCount: 9, regionCount: 5,
    incidentPortRegion: [[0], [0, 1], [0, 2], [0, 3], [1, 4], [2, 4], [4], [0, 4], [0]],
    regionIncidentPorts: [[3, 2, 8, 0, 7, 1, 2], [4, 1], [2, 5], [3], [5, 6, 4, 7]],
    regionWidth: new Float64Array(5).fill(3.25), regionHeight: new Float64Array(5).fill(2.25),
    regionCenterX: new Float64Array([0.5, 1.5, 1.5, 0.5, 2.5]), regionCenterY: new Float64Array([0, 1, -1, 0, 0]),
    portX: new Float64Array([0, 1, 1, 1, 2, 2, 3, 1, 0.5]), portY: new Float64Array([0, 1, -1, 0, 1, -1, 0, 0, 0]),
    portZ: new Int32Array(9), portAngleForRegion1: new Int32Array([0, 9000, -9000, 1000, 0, 0, 18000, 18000, 4000]),
    portAngleForRegion2: new Int32Array([0, 18000, 18000, 18000, 9000, -9000, 0, 0, 0]),
  }
}

function createProblem(includePenalty: boolean, blockFirstBranch: boolean): TinyHyperGraphProblem {
  const regionNetId = new Int32Array(5).fill(-1)
  if (blockFirstBranch) regionNetId[1] = 91
  return {
    routeCount: 1, routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([6]),
    routeNet: new Int32Array([17]), regionNetId,
    portSectionMask: new Int8Array([1, 1, 1, 0, 1, 1, 0, 0, 1]),
    ...(includePenalty ? { portPenalty: new Float64Array([0, 3, 3, 5, 1, 1, 7, 0, 0]) } : {}),
  }
}

function candidatePath(candidate: Candidate): number[] {
  const path: number[] = []
  for (let current: Candidate | undefined = candidate; current; current = current.prevCandidate) {
    path.push(current.hopId!, current.prevRegionId ?? -1, current.nextRegionId,
      current.portId, current.g, current.h, current.f)
  }
  return path
}

function observableState(solver: TinyHyperGraphSolver): unknown {
  const state = solver.state
  return {
    iterations: solver.iterations, solved: solver.solved, failed: solver.failed, error: solver.error,
    queue: state.candidateQueue.toArray().map(candidatePath), stats: solver.stats,
    currentRouteId: state.currentRouteId, currentRouteNetId: state.currentRouteNetId,
    goalPortId: state.goalPortId, unroutedRoutes: state.unroutedRoutes,
    portAssignment: state.portAssignment, regionSegments: state.regionSegments,
    regionIntersectionCaches: state.regionIntersectionCaches, regionCongestionCost: state.regionCongestionCost,
    bestCosts: Array.from({ length: solver.topology.portCount }, (_, port) =>
      Array.from({ length: solver.topology.regionCount }, (_, region) => solver.getCandidateBestCost(solver.getHopId(port, region)))),
  }
}

test("packed ordered incidence retains every native expansion prefix, goal scoring, reservation, and best-cost wrap", (): void => {
  for (const addDistance of [false, true]) {
    for (const sparse of [false, true]) {
      for (const includePenalty of [false, true]) {
        for (const blockFirstBranch of [false, true]) {
          const topology = createTopology()
          const options = { MAX_ITERATIONS: 100, STATIC_REACHABILITY_PRECHECK: false,
            TRACE_DENSITY_COST_FACTOR: 0.75, DISTANCE_TO_COST: 0.17,
            USE_SPARSE_CANDIDATE_STORAGE: sparse, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false }
          const original = new OriginalHarness(topology, createProblem(includePenalty, blockFirstBranch), options, addDistance)
          const packed = new PackedHarness(topology, createProblem(includePenalty, blockFirstBranch), options, addDistance)
          for (const solver of [original, packed]) {
            solver.setCandidateBestCost(solver.getHopId(2, 2), 0)
            solver.setCandidateBestCost(solver.getHopId(8, 4), -123)
            solver.state.candidateBestCostGeneration = 0xffffffff
          }
          for (let prefix = 0; !original.solved && !original.failed; prefix++) {
            if (prefix > 100) throw new Error("Native routing did not terminate within the fixture budget")
            original.step()
            packed.step()
            expect(observableState(packed)).toEqual(observableState(original))
            expect(packed.trace).toEqual(original.trace)
          }
          expect(packed.solved).toBe(true)
          expect(packed.failed).toBe(false)
          expect(packed.state.candidateBestCostGeneration).toBe(1)
          const scoredGoal = packed.trace.find((entry) => entry[0] === "goal" && entry[1] === 6)
          expect(scoredGoal).toBeDefined()
          expect(scoredGoal![3] as number).toBeGreaterThan(includePenalty ? 7 : 0)
          const sourceNeighbors = packed.trace.filter((entry) => entry[0] === "g" && entry[1] === 0).map((entry) => entry[2])
          expect(sourceNeighbors).toEqual(blockFirstBranch ? [2, 2] : [2, 1, 2])
        }
      }
    }
  }
})
