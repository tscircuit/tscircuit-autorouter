import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("initial DRC workers preserve the pipeline iteration limit", async (): Promise<void> => {
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
  const createPipeline = (): AutoroutingPipelineSolver9_PreloadedTraceGraph => {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
      effort: 1,
      cacheProvider: null,
    })
    const index = solver.pipelineDef.findIndex(
      (step) => step.solverName === "pipeline9JointDrcRepairSolver",
    )
    expect(index).toBeGreaterThanOrEqual(0)
    solver.currentPipelineStepIndex = index
    solver.pipelineDef[index]!.getConstructorParams = () => [params]
    solver.MAX_ITERATIONS = 0
    return solver
  }
  const serial = createPipeline()
  const parallel = createPipeline()
  const runtime = new SolverRuntime({
    workerCount: 2,
    workerUrl: new URL("../../lib/runtime/bun.worker.ts", import.meta.url),
    requireWorker: true,
  })
  try {
    serial.solve()
    await parallel.solveAsync(runtime)
    expect(parallel.failed).toBe(serial.failed)
    expect(parallel.solved).toBe(serial.solved)
    expect(parallel.error).toBe(serial.error)
    expect(parallel.iterations).toBe(serial.iterations)
    expect(parallel.currentPipelineStepIndex).toBe(serial.currentPipelineStepIndex)
  } finally {
    await runtime.dispose()
  }
})
