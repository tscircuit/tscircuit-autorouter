import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { TinyGoalBallHeuristic } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyGoalBallHeuristic"
import { TinyGoalBallSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyGoalBallSelectiveReripHyperGraphSolver"
import { executeParallelStageJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerJobs"
import type { ParallelStageWorkerJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerTypes"

test("goal-ball preparation shares immutable net masks, deduplicates targets and matches four existing workers", async (): Promise<void> => {
  const topology = {
    portCount: 7, regionCount: 2,
    incidentPortRegion: [[0], [0, 1], [1], [0], [0, 1], [1], []], regionIncidentPorts: [[0, 1, 3, 4], [1, 2, 4, 5]],
    regionWidth: new Float64Array([2, 2]), regionHeight: new Float64Array([2, 2]),
    regionCenterX: new Float64Array([1, 3]), regionCenterY: new Float64Array([1, 1]),
    portX: new Float64Array([0, 2, 4, 0, 2, 4, 100]), portY: new Float64Array([0, 0, 0, 2, 2, 2, 100]),
    portZ: new Int32Array([0, 1, 0, 1, 0, 1, 0]),
    portAngleForRegion1: new Int32Array([22500, 31500, 31500, 13500, 4500, 4500, 0]),
    portAngleForRegion2: new Int32Array([0, 22500, 0, 0, 13500, 0, 0]), regionAvailableZMask: new Int32Array([3, 3]),
  }
  const problem = {
    routeCount: 5, routeStartPort: new Int32Array([0, 1, 0, 1, 0]), routeEndPort: new Int32Array([2, 3, 4, 5, 5]),
    routeNet: new Int32Array(5).fill(10), regionNetId: new Int32Array(2).fill(-1),
    portSectionMask: new Int8Array([1, 1, 1, 1, 0, 1, 0]), portPenalty: new Float64Array([0, 1, 3, 150, 7, 50, 0]),
  }
  const solver = new TinyGoalBallSelectiveReripHyperGraphSolver(topology, problem, { minViaPadDiameter: 0.6 })
  const serial = new TinyGoalBallHeuristic(solver, 2)
  const parallel = new TinyGoalBallHeuristic(solver, 2)
  expect(() => serial.getBounds(10, 5)).toThrow("before target preparation")
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    serial.prepareSync()
    await parallel.prepare(pool)
    expect(parallel.ready).toBe(true)
    expect(parallel.stats.goalBallGroupCount).toBe(4)
    expect(parallel.stats.goalBallWorkerJobCount).toBe(4)
    expect(pool.stats.maxActiveWorkers).toBe(4)
    expect(parallel.graph.targets.buffer).toBeInstanceOf(SharedArrayBuffer)
    expect(parallel.stats.goalBallExpandedPortCount).toBe(serial.stats.goalBallExpandedPortCount)
    expect(parallel.stats.goalBallRelaxationCount).toBe(serial.stats.goalBallRelaxationCount)
    for (const target of [2, 3, 4, 5]) {
      expect(parallel.getBounds(10, target)).toEqual(serial.getBounds(10, target))
      expect(parallel.getBounds(10, target)[target]).toBe(0)
      solver.state.currentRouteId = 0
      solver.state.currentRouteNetId = 10
      for (let region = 0; region < 2; region++) for (const from of topology.regionIncidentPorts[region]!) {
        for (const to of topology.regionIncidentPorts[region]!) {
          if (from === to) continue
          const cost = solver.computeG({ portId: from, nextRegionId: region, g: 0, f: 0, h: 0 }, to)
          expect(parallel.getBounds(10, target)[from]).toBeLessThanOrEqual(cost + parallel.getBounds(10, target)[to]! + 1e-9)
        }
      }
    }
    const initialJobs = parallel.stats.goalBallWorkerJobCount
    const pending = parallel.ensureGoal(10, 1, 0, pool)
    expect(pending).toBeDefined()
    expect(parallel.ensureGoal(10, 1, 0, pool)).toBe(pending)
    expect(() => parallel.ensureGoal(10, 1, 6, pool)).toThrow("mask changed during worker preparation")
    await pending
    serial.ensureGoal(10, 1, 0)
    expect(parallel.getBounds(10, 1)).toEqual(serial.getBounds(10, 1))
    expect(parallel.stats.goalBallWorkerJobCount).toBe(initialJobs + 1)
    expect(parallel.ensureGoal(10, 1, 0, pool)).toBeUndefined()
    expect(() => new TinyGoalBallHeuristic(solver, 0)).toThrow("positive search capacity")
    const rejected = new TinyGoalBallHeuristic(solver)
    await expect(rejected.prepare({ run: async <T,>(job: ParallelStageWorkerJob): Promise<T> =>
      (job.kind === "pathingLandmark" ? executeParallelStageJob(job) : { kind: "invalid" }) as T })).rejects.toThrow("Invalid goal-ball")
    expect(rejected.ready).toBe(false)
  } finally { pool.dispose() }
})
