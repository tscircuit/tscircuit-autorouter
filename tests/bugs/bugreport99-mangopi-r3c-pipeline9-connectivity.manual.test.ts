import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "../../fixtures/bug-reports/bugreport99-mangopi-r3c-pipeline9-connectivity/bugreport99-mangopi-r3c-pipeline9-connectivity.srj.json" with {
  type: "json",
}

test.skip(
  "manual: Pipeline 9 reaches MangoPi power expansion and later reports solved",
  () => {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(simpleRouteJson) as SimpleRouteJson,
      {
        effort: 1,
        cacheProvider: null,
      },
    )

    solver.solve()

    expect(solver.powerTraceExpansionSolver).toBeDefined()
    expect(solver.powerTraceExpansionSolver?.failed).toBeFalse()
    expect(solver.powerTraceExpansionSolver?.solved).toBeTrue()
    expect(solver.error).toBeNull()
    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()
    expect(solver.getOutputSimpleRouteJson().traces).toHaveLength(405)
  },
)
