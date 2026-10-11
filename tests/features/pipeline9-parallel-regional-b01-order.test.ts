import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import * as regional from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import { Pipeline9RegionalB01RepairSolver, type Pipeline9RegionalB01CandidateParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"
import { ParallelPipeline9RegionalB01RepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPipeline9RegionalB01RepairSolver"
import type { ParallelRegionalB01CandidateResult, ParallelStageWorkerJob, ParallelStageWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerTypes"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

function createParams(routeCount: number, errors: regional.Pipeline9RegionalB01RepairParams["initialErrors"]): regional.Pipeline9RegionalB01RepairParams {
  const routes: HighDensityRoute[] = Array.from({ length: routeCount }, (_, index) => ({
    connectionName: `signal${index}`, traceThickness: 0.1, viaDiameter: 0.3, vias: [],
    route: [{ x: -4, y: index, z: 0 }, { x: 0, y: index, z: 0 }, { x: 4, y: index, z: 0 }],
  }))
  const srj = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -8, minY: -8, maxX: 8, maxY: 600 }, obstacles: [],
    connections: routes.map((route) => ({ name: route.connectionName, pointsToConnect: [{ x: -4, y: 0, layer: "top" }, { x: 4, y: 0, layer: "top" }] })) }
  return { srj, routes, initialErrors: errors, fixedObstacleRoutes: [], newConnections: srj.connections,
    syntheticConnectionNames: new Set(), preloadRepairTraceIds: new Set(["signal0_0"]),
    connMap: new ConnectivityMap({}), colorMap: {}, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1,
    drcEvaluator: ({ routes: candidate, hdRoutes }) => {
      const first = (candidate ?? hdRoutes)![0]! as HighDensityRoute
      return { errors: first.regionId ? [] : errors! }
    }, }
}

function candidateOutput(params: Pipeline9RegionalB01CandidateParams): ReturnType<typeof regional.getPipeline9RegionalB01CandidateOutput> {
  const replacement = { ...params.routes[params.routeIndex]!, regionId: `candidate${params.regionSize}` }
  return {
    routes: params.routes.map((route, index) => index === params.routeIndex ? replacement : route),
    usedFallback: params.regionSize === 4,
  }
}

test("parallel B01 commits serial candidate order, null attempts, fallback and finite exhaustion", async (): Promise<void> => {
  const error = { type: "pcb_trace_error", pcb_trace_id: "signal0_0", center: { x: 0, y: 0 } }
  let exhaust = false
  const descriptorByProblem = new WeakMap<regional.Pipeline9RegionalB01CandidateProblem, Pipeline9RegionalB01CandidateParams>()
  const prepare = spyOn(regional, "preparePipeline9RegionalB01Candidate").mockImplementation((params) => {
    if (!exhaust && params.regionSize === 3) return undefined
    const child = new BaseSolver()
    child.MAX_ITERATIONS = 1
    child._step = (): void => { child.solved = true }
    const problem = { solver: child, routes: params.routes, routeIndex: params.routeIndex } as unknown as regional.Pipeline9RegionalB01CandidateProblem
    descriptorByProblem.set(problem, params)
    return problem
  })
  const output = spyOn(regional, "getPipeline9RegionalB01CandidateOutput").mockImplementation((problem) => exhaust ? undefined : candidateOutput(descriptorByProblem.get(problem)!))
  const regular = spyOn(regional, "preparePipeline9RegularRegionalCandidate").mockImplementation(() => undefined)
  try {
    for (const shouldExhaust of [false, true]) {
      exhaust = shouldExhaust
      const serialParams = createParams(shouldExhaust ? 500 : 2, Array.from({ length: shouldExhaust ? 20 : 1 }, () => ({ ...error })))
      const parallelParams = createParams(shouldExhaust ? 500 : 2, serialParams.initialErrors)
      const completed: number[] = []
      const scheduled: number[] = []
      const pool: ParallelStageWorkerPool = {
        run<T>(job: ParallelStageWorkerJob): Promise<T> {
          if (job.kind !== "regionalB01Candidate") throw new Error("Unexpected job")
          scheduled.push(job.params.regionSize)
          return new Promise((resolve) => setTimeout(() => {
            completed.push(job.params.regionSize)
            const result: ParallelRegionalB01CandidateResult = !shouldExhaust && job.params.regionSize === 8
              ? { kind: job.kind, status: "error", error: "Skipped speculative failure" }
              : { kind: job.kind, status: !shouldExhaust && job.params.regionSize === 3 ? "skipped" : "prepared",
                  childStepBudget: shouldExhaust || job.params.regionSize !== 3 ? 2 : 0,
                  replacement: shouldExhaust || job.params.regionSize === 3 ? undefined : candidateOutput({ ...job.params, connMap: new ConnectivityMap(job.connectivityNetMap) })!.routes[job.params.routeIndex],
                  usedFallback: !shouldExhaust && job.params.regionSize === 4 }
            resolve(result as T)
          }, 9 - job.params.regionSize))
        },
      }
      const serial = new Pipeline9RegionalB01RepairSolver(serialParams)
      const parallel = new ParallelPipeline9RegionalB01RepairSolver({ ...parallelParams, workerPool: pool })
      serial.solve()
      await parallel.solveAsync()
      expect(parallel.failed, parallel.error ?? "").toBeFalse()
      expect(parallel.getResult()).toEqual(serial.getResult())
      expect(parallel.getResult().routes[1]).toBe(parallelParams.routes[1])
      expect(scheduled.length).toBeGreaterThan(0)
      if (shouldExhaust) {
        expect(parallel.getResult()).toMatchObject({ candidateSearchCount: 16, candidateSearchBudget: 16,
          candidateSearchBudgetExhausted: true, safeTraceLayerRepairSkippedForBudget: true, attemptedCandidateCount: 0 })
      } else {
        expect(completed[0]).toBe(8)
        expect(parallel.getResult()).toMatchObject({ candidateSearchCount: 2, attemptedCandidateCount: 1,
          acceptedCandidateCount: 1, fallbackCandidateCount: 1, remainingDrcIssueCount: 0 })
        expect(parallel.getResult().routes[0]!.regionId).toBe("candidate4")
      }
    }
  } finally {
    prepare.mockRestore()
    output.mockRestore()
    regular.mockRestore()
  }
})
