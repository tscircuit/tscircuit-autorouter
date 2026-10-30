import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import { Pipeline9InitialDrcSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InitialDrcSolver"
import {
  getPipeline9InitialDrcInputs,
  Pipeline9JointDrcRepairSolver,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("initial DRC worker snapshots preserve joint repair results", async (): Promise<void> => {
  const fixture = createBoundedRegionalRepairFixture()
  const srj = fixture.originalSrj
  const params = {
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: fixture.routes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set<string>(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  }
  const runtime = new SolverRuntime({
    workerCount: 2,
    workerUrl: new URL("../../lib/runtime/bun.worker.ts", import.meta.url),
    requireWorker: true,
  })
  try {
    const [baselineInput, currentInput] = getPipeline9InitialDrcInputs(params)
    const [baseline, current] = await Promise.all([
      runtime.executeAsync(Pipeline9InitialDrcSolver, baselineInput),
      runtime.executeAsync(Pipeline9InitialDrcSolver, currentInput),
    ])
    const serial = new Pipeline9JointDrcRepairSolver(params)
    const parallel = new Pipeline9JointDrcRepairSolver(params, {
      baseline,
      current,
      workerTimeMs: 0,
    })
    serial.solve()
    parallel.solve()
    expect(serial.failed).toBe(false)
    expect(parallel.failed).toBe(false)
    expect(parallel.getOutput()).toEqual(serial.getOutput())
    expect(parallel.getUpdatedPreloadedTraces()).toEqual(serial.getUpdatedPreloadedTraces())
    expect(parallel.stats.initialJointDrcIssueCount).toBe(serial.stats.initialJointDrcIssueCount)
    expect(parallel.stats.initialDrcWorkerCount).toBe(2)
  } finally {
    await runtime.dispose()
  }
})
