import { expect, test } from "bun:test"
import { Pipeline9RegionalB01RepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"
import { ParallelPipeline9RegionalB01RepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPipeline9RegionalB01RepairSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import type { Pipeline9RegionalB01RepairParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

function createParams(forceFallback: boolean): Pipeline9RegionalB01RepairParams {
  const fixture = createBoundedRegionalRepairFixture()
  const constantErrors = [{ type: "pcb_trace_error", pcb_trace_id: "signal_0", center: { x: 0, y: 0 } }]
  return { srj: fixture.originalSrj, routes: fixture.routes, fixedObstacleRoutes: [],
    newConnections: fixture.originalSrj.connections, syntheticConnectionNames: new Set(),
    drcEvaluator: forceFallback ? () => ({ errors: constantErrors, errorsWithCenters: constantErrors }) : fixture.drcEvaluator,
    preloadRepairTraceIds: new Set(["signal_0"]), connMap: getConnectivityMapFromSimpleRouteJson(fixture.originalSrj),
    colorMap: {}, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1 }
}

test("regional B01 worker solves preserve successful routing and regular fallback", async (): Promise<void> => {
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    for (const forceFallback of [false, true]) {
      const serial = new Pipeline9RegionalB01RepairSolver(createParams(forceFallback))
      const parallelParams = createParams(forceFallback)
      const parallel = new ParallelPipeline9RegionalB01RepairSolver({ ...parallelParams, workerPool: pool })
      serial.solve()
      await parallel.solveAsync()
      expect(parallel.failed, parallel.error ?? "").toBeFalse()
      expect(parallel.getResult()).toEqual(serial.getResult())
      if (forceFallback) {
        expect(parallel.getResult().fallbackCandidateCount).toBeGreaterThan(0)
        expect(parallel.getResult().acceptedCandidateCount).toBe(0)
        expect(parallel.getResult().routes[0]).toBe(parallelParams.routes[0])
      } else {
        expect(parallel.getResult().acceptedCandidateCount).toBeGreaterThan(0)
        expect(parallel.getResult().remainingDrcIssueCount).toBe(0)
      }
    }
    expect(pool.stats.maxActiveWorkers).toBeLessThanOrEqual(4)
    expect(pool.stats.maxActiveWorkers).toBeGreaterThan(1)
  } finally {
    pool.dispose()
  }
})
