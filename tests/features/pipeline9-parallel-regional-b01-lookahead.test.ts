import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import * as regional from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import { Pipeline9RegionalB01RepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"
import { ParallelPipeline9RegionalB01RepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPipeline9RegionalB01RepairSolver"
import type { ParallelRegionalB01CandidateResult, ParallelRegionalFallbackResult, ParallelStageWorkerJob, ParallelStageWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerTypes"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

type ScheduledCandidate = {
  job: ParallelStageWorkerJob
  complete: (result: ParallelRegionalB01CandidateResult | ParallelRegionalFallbackResult) => void
}

function createParams(): regional.Pipeline9RegionalB01RepairParams {
  const routes: HighDensityRoute[] = [0, 1].map((index) => ({
    connectionName: `signal${index}`, traceThickness: 0.1, viaDiameter: 0.3, vias: [],
    route: [{ x: -4, y: index, z: 0 }, { x: 0, y: index, z: 0 }, { x: 4, y: index, z: 0 }],
  }))
  const srj = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -8, minY: -8, maxX: 8, maxY: 8 }, obstacles: [],
    connections: routes.map((route) => ({ name: route.connectionName, pointsToConnect: [{ x: -4, y: 0, layer: "top" }, { x: 4, y: 0, layer: "top" }] })) }
  const errors = [{ type: "pcb_trace_error", pcb_trace_id: "signal0_0", pcb_trace_ids: ["signal0_0", "signal1_0"], center: { x: 0, y: 0 } }]
  return { srj, routes, initialErrors: errors, fixedObstacleRoutes: [], newConnections: srj.connections,
    syntheticConnectionNames: new Set(), preloadRepairTraceIds: new Set(["signal0_0"]), connMap: new ConnectivityMap({}),
    colorMap: {}, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1,
    drcEvaluator: ({ routes: candidate, hdRoutes }) => ({ errors: ((candidate ?? hdRoutes)![0] as HighDensityRoute).regionId ? [] : errors }) }
}

test("B01 launches a bounded prefix and reserves the running fallback slot before an early winner", async (): Promise<void> => {
  let prefetch = false
  const prepareB01 = spyOn(regional, "preparePipeline9RegionalB01Candidate").mockImplementation((params) => {
    const child = new BaseSolver()
    child.MAX_ITERATIONS = 1
    child._step = (): void => { child.solved = true }
    return { solver: child, routes: params.routes, routeIndex: params.routeIndex } as unknown as regional.Pipeline9RegionalB01CandidateProblem
  })
  const outputB01 = spyOn(regional, "getPipeline9RegionalB01CandidateOutput").mockImplementation((problem) => ({
    routes: problem.routes.map((route, index) => index === problem.routeIndex ? { ...route, regionId: "winner" } : route), usedFallback: false,
  }))
  const prepareRegular = spyOn(regional, "preparePipeline9RegularRegionalCandidate").mockImplementation((params) => {
    if (!prefetch) return undefined
    const child = new BaseSolver()
    Object.assign(child, { params: { nodeWithPortPoints: { capacityMeshNodeId: "test", center: params.center, width: 3, height: 3,
      availableZ: [0, 1], portPoints: [] }, colorMap: params.colorMap, viaDiameter: params.viaDiameter, traceWidth: params.traceWidth,
      obstacleMargin: params.obstacleMargin, effort: params.effort, obstacles: [], layerCount: 2, connMap: params.connMap } })
    return { solver: child, routes: params.routes } as unknown as regional.Pipeline9RegularRegionalCandidateProblem
  })
  try {
    for (const reserveFallback of [false, true]) {
      prefetch = reserveFallback
      const scheduled: ScheduledCandidate[] = []
      const pool: ParallelStageWorkerPool = {
        run<T>(job: ParallelStageWorkerJob): Promise<T> {
          return new Promise((resolve) => scheduled.push({ job, complete: (result): void => resolve(result as T) }))
        },
      }
      const params = createParams()
      const serial = new Pipeline9RegionalB01RepairSolver(createParams())
      const parallel = new ParallelPipeline9RegionalB01RepairSolver({ ...params, workerPool: pool })
      const solving = parallel.solveAsync()
      // Each awaited coordinator step yields, including setup before its first job.
      while (scheduled.length === 0) await Promise.resolve()
      expect(scheduled).toHaveLength(4)
      const b01Jobs = scheduled.filter(({ job }) => job.kind === "regionalB01Candidate")
      expect(b01Jobs).toHaveLength(reserveFallback ? 3 : 4)
      expect(b01Jobs.map(({ job }) => job.kind === "regionalB01Candidate" ? job.params.regionSize : 0)).toEqual(reserveFallback ? [3, 4, 5] : [3, 4, 5, 6])
      const first = b01Jobs[0]!
      if (first.job.kind !== "regionalB01Candidate") throw new Error("Expected first B01 candidate")
      first.complete({ kind: first.job.kind, status: "prepared", childStepBudget: 2, usedFallback: false,
        replacement: { ...first.job.params.routes[0]!, regionId: "winner" } })
      serial.solve()
      await solving
      expect(parallel.getResult()).toEqual(serial.getResult())
      expect(parallel.getResult()).toMatchObject({ candidateSearchCount: 1, acceptedCandidateCount: 1, fallbackCandidateCount: 0 })
      expect(parallel.getResult().routes[1]).toBe(params.routes[1])
      expect(scheduled).toHaveLength(4)
      // Resolve unused work after completion; it cannot publish routes or launch more.
      for (const candidate of scheduled) candidate.complete(candidate.job.kind === "regionalFallbackSolve"
        ? { kind: "regionalFallbackSolve", status: "error", error: "unused fallback" }
        : { kind: "regionalB01Candidate", status: "error", error: "unused B01" })
      await Promise.resolve()
      expect(parallel.failed).toBeFalse()
      expect(scheduled).toHaveLength(4)
    }
  } finally {
    prepareB01.mockRestore()
    outputB01.mockRestore()
    prepareRegular.mockRestore()
  }
})
