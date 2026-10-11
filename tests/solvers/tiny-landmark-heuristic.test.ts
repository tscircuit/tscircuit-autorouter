import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { TinyLandmarkHeuristic, computeTinyLandmarkDistances } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyLandmarkHeuristic"
import { TinyIndexedSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyIndexedSelectiveReripHyperGraphSolver"
import type { TinyHyperGraphTopology, TinyHyperGraphProblem } from "tiny-hypergraph/lib/core"

function fixture(): { topology: TinyHyperGraphTopology; problem: TinyHyperGraphProblem } {
  return {
    topology: {
      portCount: 7, regionCount: 2,
      incidentPortRegion: [[0], [0, 1], [1], [0], [0, 1], [1], []],
      regionIncidentPorts: [[0, 1, 3, 4], [1, 2, 4, 5]],
      regionWidth: new Float64Array([2, 2]), regionHeight: new Float64Array([2, 2]),
      regionCenterX: new Float64Array([1, 3]), regionCenterY: new Float64Array([1, 1]),
      portX: new Float64Array([0, 2, 4, 0, 2, 4, 100]),
      portY: new Float64Array([0, 0, 0, 2, 2, 2, 100]),
      portZ: new Int32Array([0, 1, 0, 1, 0, 1, 0]),
      portAngleForRegion1: new Int32Array([22500, 31500, 31500, 13500, 4500, 4500, 0]),
      portAngleForRegion2: new Int32Array([0, 22500, 0, 0, 13500, 0, 0]),
      regionAvailableZMask: new Int32Array([3, 3]),
    },
    problem: {
      routeCount: 2, routeStartPort: new Int32Array([0, 3]), routeEndPort: new Int32Array([5, 4]),
      routeNet: new Int32Array([10, 20]), regionNetId: new Int32Array(2).fill(-1),
      portSectionMask: new Int8Array(7).fill(1),
      portPenalty: new Float64Array([0, 150, 3, 0, 150, 0, 0]),
    },
  }
}

test("landmark bounds are consistent with actual region costs, shortest paths and worker preparation", async (): Promise<void> => {
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    for (const occupied of [false, true]) for (const density of [0, 1]) {
      const { topology, problem } = fixture()
      if (occupied) problem.initialAssignments = [{ routeId: 1, regionId: 0, fromPortId: 3, toPortId: 4 }]
      const solver = new TinyIndexedSelectiveReripHyperGraphSolver(topology, problem, {
        TRACE_DENSITY_COST_FACTOR: density, minViaPadDiameter: 0.6,
      })
      solver.state.currentRouteNetId = 10
      solver.state.currentRouteId = 0
      solver.state.regionCongestionCost.set([0.4, 0.2])
      const heuristic = new TinyLandmarkHeuristic(solver)
      expect(() => heuristic.lowerBound(0, 5)).toThrow("before preparation")
      heuristic.prepareSync()
      const parallel = new TinyLandmarkHeuristic(solver)
      await parallel.prepare(pool)
      expect(parallel.stats).toEqual(heuristic.stats)
      expect(heuristic.stats.landmarkCount).toBe(4)
      const actualCosts = Array.from({ length: 7 }, (_, source) =>
        Array.from({ length: 7 }, (_, target) => source === target ? 0 : Infinity))
      for (let regionId = 0; regionId < topology.regionCount; regionId++) {
        for (const source of topology.regionIncidentPorts[regionId]!) for (const target of topology.regionIncidentPorts[regionId]!) {
          if (source === target) continue
          const cost = solver.computeG({ portId: source, nextRegionId: regionId, f: 0, g: 0, h: 0 }, target)
          actualCosts[source]![target] = Math.min(actualCosts[source]![target]!, cost)
          for (let goal = 0; goal < 7; goal++) {
            expect(heuristic.lowerBound(source, goal)).toBeLessThanOrEqual(cost + heuristic.lowerBound(target, goal) + 1e-9)
          }
        }
      }
      // Exhaustive directed all-pairs shortest paths use the original scorer,
      // including committed crossings, congestion, density, vias and penalties.
      for (let via = 0; via < 7; via++) for (let source = 0; source < 7; source++) for (let target = 0; target < 7; target++) {
        actualCosts[source]![target] = Math.min(actualCosts[source]![target]!, actualCosts[source]![via]! + actualCosts[via]![target]!)
      }
      for (let source = 0; source < 7; source++) for (let target = 0; target < 7; target++) {
        const bound = heuristic.lowerBound(source, target)
        expect(bound).toBeGreaterThanOrEqual(0)
        expect(bound).toBeLessThanOrEqual(actualCosts[source]![target]! + 1e-9)
        expect(parallel.lowerBound(source, target)).toBe(bound)
      }
      expect(heuristic.lowerBound(0, 5)).toBeGreaterThan(150)
    }
    expect(pool.stats.maxActiveWorkers).toBe(4)
    for (const key of ["DISTANCE_TO_COST", "TRACE_DENSITY_COST_FACTOR", "RIP_CONGESTION_REGION_COST_FACTOR", "minViaPadDiameter"] as const) {
      const { topology, problem } = fixture()
      const invalid = new TinyIndexedSelectiveReripHyperGraphSolver(topology, problem)
      invalid[key] = -1
      expect(() => new TinyLandmarkHeuristic(invalid)).toThrow("nonnegative cost options")
    }
    const { topology, problem } = fixture()
    problem.portPenalty![0] = -1
    expect(() => new TinyLandmarkHeuristic(new TinyIndexedSelectiveReripHyperGraphSolver(topology, problem))).toThrow("nonnegative port penalties")
    problem.portPenalty![0] = 0
    const inconsistent = new TinyIndexedSelectiveReripHyperGraphSolver(topology, problem)
    inconsistent.state.regionIntersectionCaches[0]!.existingRegionCost = 10
    expect(() => new TinyLandmarkHeuristic(inconsistent)).toThrow("consistent nonnegative region costs")
    expect(() => computeTinyLandmarkDistances({ portOffsets: new Int32Array([0, 1, 1]),
      targets: new Int32Array([1]), costs: new Float64Array([-1]) }, 0)).toThrow("edge cost")
    for (const invalidIncidence of ["missing-reverse", "duplicate-region-port"] as const) {
      const { topology, problem } = fixture()
      if (invalidIncidence === "missing-reverse") topology.incidentPortRegion[1] = [1]
      else topology.regionIncidentPorts[0]!.push(0)
      expect(() => new TinyLandmarkHeuristic(new TinyIndexedSelectiveReripHyperGraphSolver(topology, problem))).toThrow("symmetric region-port incidence")
    }
  } finally { pool.dispose() }
})
