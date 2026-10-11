import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import * as regional from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import { Pipeline9RegionalB01RepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"
import { ParallelPipeline9RegionalB01RepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPipeline9RegionalB01RepairSolver"
import type { ParallelRegionalB01CandidateResult, ParallelRegionalFallbackResult, ParallelStageWorkerJob, ParallelStageWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerTypes"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

type Mode = "skip-preparation-error" | "skip-worker-error" | "consume-preparation-error" | "consume-worker-error" | "exhaust"

function createParams(exhaust: boolean): regional.Pipeline9RegionalB01RepairParams {
  const routes: HighDensityRoute[] = Array.from({ length: exhaust ? 500 : 2 }, (_, index) => ({
    connectionName: `signal${index}`, traceThickness: 0.1, viaDiameter: 0.3, vias: [],
    route: [{ x: -4, y: index, z: 0 }, { x: 0, y: index, z: 0 }, { x: 4, y: index, z: 0 }],
  }))
  const srj = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -8, minY: -8, maxX: 8, maxY: 600 }, obstacles: [],
    connections: routes.map((route) => ({ name: route.connectionName, pointsToConnect: [{ x: -4, y: 0, layer: "top" }, { x: 4, y: 0, layer: "top" }] })) }
  const errors = Array.from({ length: exhaust ? 20 : 1 }, () => ({ type: "pcb_trace_error", pcb_trace_id: "signal0_0", center: { x: 0, y: 0 } }))
  return { srj, routes, initialErrors: errors, fixedObstacleRoutes: [], newConnections: srj.connections,
    syntheticConnectionNames: new Set(), preloadRepairTraceIds: new Set(["signal0_0"]), connMap: new ConnectivityMap({}),
    colorMap: {}, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1,
    drcEvaluator: ({ routes: candidate, hdRoutes }) => ({ errors: ((candidate ?? hdRoutes)![0] as HighDensityRoute).regionId ? [] : errors }), }
}

test("regular fallback speculation defers errors and honors serial authorization and budget reachability", async (): Promise<void> => {
  let mode: Mode = "skip-preparation-error"
  const prepareB01 = spyOn(regional, "preparePipeline9RegionalB01Candidate").mockImplementation((params) => {
    if (!mode.startsWith("skip")) return undefined
    const child = new BaseSolver()
    child._step = (): void => { child.solved = true }
    return { solver: child, routes: params.routes, routeIndex: params.routeIndex } as unknown as regional.Pipeline9RegionalB01CandidateProblem
  })
  const outputB01 = spyOn(regional, "getPipeline9RegionalB01CandidateOutput").mockImplementation((problem) => ({
    routes: problem.routes.map((route, index) => index === problem.routeIndex ? { ...route, regionId: "winner" } : route), usedFallback: false,
  }))
  const prepareRegular = spyOn(regional, "preparePipeline9RegularRegionalCandidate").mockImplementation((params) => {
    if (mode.endsWith("preparation-error")) throw new Error("deferred preparation failure")
    const child = new BaseSolver()
    child.MAX_ITERATIONS = 1
    child._step = (): void => {
      if (mode.endsWith("worker-error")) throw new Error("deferred worker failure")
      child.failed = true
    }
    Object.assign(child, { params: { nodeWithPortPoints: { capacityMeshNodeId: "test", center: params.center, width: 3, height: 3,
      availableZ: [0, 1], portPoints: [] }, colorMap: params.colorMap, viaDiameter: params.viaDiameter, traceWidth: params.traceWidth,
      obstacleMargin: params.obstacleMargin, effort: params.effort, obstacles: [], layerCount: 2, connMap: params.connMap } })
    return { solver: child, routes: params.routes } as unknown as regional.Pipeline9RegularRegionalCandidateProblem
  })
  try {
    for (const nextMode of ["skip-preparation-error", "skip-worker-error", "consume-preparation-error", "consume-worker-error", "exhaust"] as Mode[]) {
      mode = nextMode
      const jobs: string[] = []
      const pool: ParallelStageWorkerPool = {
        run<T>(job: ParallelStageWorkerJob): Promise<T> {
          jobs.push(job.kind)
          let result: ParallelRegionalB01CandidateResult | ParallelRegionalFallbackResult
          if (job.kind === "regionalFallbackSolve") {
            result = nextMode.endsWith("worker-error") ? { kind: job.kind, status: "error", error: "deferred worker failure" }
              : { kind: job.kind, status: "prepared", solved: false, failed: true, childStepBudget: 2 }
          } else if (job.kind === "regionalB01Candidate") {
            result = { kind: job.kind, status: nextMode.startsWith("skip") ? "prepared" : "skipped", usedFallback: false,
              childStepBudget: nextMode.startsWith("skip") ? 1001 : 0,
              replacement: nextMode.startsWith("skip") ? { ...job.params.routes[job.params.routeIndex]!, regionId: "winner" } : undefined }
          } else throw new Error("Unexpected job")
          return Promise.resolve(result as T)
        },
      }
      const serial = new Pipeline9RegionalB01RepairSolver(createParams(nextMode === "exhaust"))
      const parallel = new ParallelPipeline9RegionalB01RepairSolver({ ...createParams(nextMode === "exhaust"), workerPool: pool })
      if (nextMode.startsWith("consume")) {
        const message = nextMode.endsWith("worker-error") ? "deferred worker failure" : "deferred preparation failure"
        expect(() => serial.solve()).toThrow(message)
        await expect(parallel.solveAsync()).rejects.toThrow(message)
        expect(parallel.failed).toBeTrue()
      } else {
        serial.solve()
        await parallel.solveAsync()
        expect(parallel.getResult()).toEqual(serial.getResult())
        if (nextMode === "exhaust") {
          expect(parallel.getResult()).toMatchObject({ candidateSearchCount: 16, candidateSearchBudgetExhausted: true })
          expect(jobs.filter((kind) => kind === "regionalFallbackSolve")).toHaveLength(2)
        } else {
          expect(parallel.getResult()).toMatchObject({ candidateSearchCount: 1, acceptedCandidateCount: 1, fallbackCandidateCount: 0 })
        }
      }
      if (nextMode !== "skip-preparation-error" && nextMode !== "consume-preparation-error") {
        expect(jobs[0]).toBe("regionalFallbackSolve")
      }
    }
  } finally {
    prepareB01.mockRestore()
    outputB01.mockRestore()
    prepareRegular.mockRestore()
  }
})
