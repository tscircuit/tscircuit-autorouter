import { expect, test } from "bun:test"
import type { Pipeline9RegionalB01RepairParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import { Pipeline9RegionalB01RepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"
import { ParallelPipeline9RegionalB01RepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPipeline9RegionalB01RepairSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

function createParams(): Pipeline9RegionalB01RepairParams {
  const fixture = createBoundedRegionalRepairFixture()
  fixture.originalSrj.bounds.maxY = 15
  fixture.originalSrj.connections.push({ name: "far", pointsToConnect: [{ x: -4, y: 10, layer: "top" }, { x: 4, y: 10, layer: "top" }] })
  fixture.routes.push({ connectionName: "far", rootConnectionName: "far", regionId: "original-region", traceThickness: 0.12,
    viaDiameter: 0.4, vias: [], route: [{ x: -4, y: 10, z: 0, pcb_port_id: "far-start" }, { x: 4, y: 10, z: 0, pcb_port_id: "far-end" }] })
  const errors = [{ type: "pcb_trace_error", pcb_trace_id: "signal_0", center: { x: 0, y: 0 } }]
  return { srj: fixture.originalSrj, routes: fixture.routes, initialErrors: errors, fixedObstacleRoutes: [],
    newConnections: fixture.originalSrj.connections, syntheticConnectionNames: new Set(), preloadRepairTraceIds: new Set(["signal_0"]),
    connMap: getConnectivityMapFromSimpleRouteJson(fixture.originalSrj), colorMap: {}, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1,
    drcEvaluator: ({ routes, hdRoutes }) => ({ errors: (routes ?? hdRoutes)!.every((route) => "preloadedTraceIndex" in route) ? [] : errors }), }
}

test("prefetched regular fallback retains exact metadata, route order and source references", async (): Promise<void> => {
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    const serial = new Pipeline9RegionalB01RepairSolver(createParams())
    const params = createParams()
    const parallel = new ParallelPipeline9RegionalB01RepairSolver({ ...params, workerPool: pool })
    serial.solve()
    await parallel.solveAsync()
    expect(parallel.getResult()).toEqual(serial.getResult())
    expect(parallel.getResult()).toMatchObject({ candidateSearchCount: 6, fallbackCandidateCount: 1,
      acceptedCandidateCount: 1, remainingDrcIssueCount: 0 })
    const output = parallel.getResult().routes
    expect(output.map((route) => route.connectionName)).toEqual(["signal", "far"])
    expect(output[0]!.route[0]).toBe(params.routes[0]!.route[0])
    expect(output[0]!.route.at(-1)).toBe(params.routes[0]!.route.at(-1))
    expect(output[1]).not.toBe(params.routes[1])
    expect(output[1]!.route).toBe(params.routes[1]!.route)
    expect(output[1]!.vias).toBe(params.routes[1]!.vias)
    expect(output[1]).toMatchObject({ rootConnectionName: "far", regionId: "original-region", traceThickness: 0.12, viaDiameter: 0.4 })
    expect(pool.stats.maxActiveWorkers).toBe(4)
  } finally {
    pool.dispose()
  }
})
