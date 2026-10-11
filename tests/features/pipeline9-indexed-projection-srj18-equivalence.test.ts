import { expect, test } from "bun:test"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { Pipeline9IndexedClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9IndexedClearanceProjectionSolver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

class IndexedProjectionOnlyBoundedSolver extends Pipeline9BoundedRegionalRepairSolver {
  static projectionsCreated = 0

  protected override createProjectionSolver(
    params: ConstructorParameters<typeof Pipeline9ClearanceProjectionSolver>[0],
  ): Pipeline9IndexedClearanceProjectionSolver {
    IndexedProjectionOnlyBoundedSolver.projectionsCreated++
    return new Pipeline9IndexedClearanceProjectionSolver(params)
  }
}

class IndexedProjectionOnlyJointSolver extends Pipeline9JointDrcRepairSolver {
  protected override createBoundedRegionalRepairSolver(
    params: ConstructorParameters<typeof Pipeline9BoundedRegionalRepairSolver>[0],
  ): IndexedProjectionOnlyBoundedSolver {
    return new IndexedProjectionOnlyBoundedSolver(params)
  }
}

test("indexed projection alone preserves full SRJ18 routing and regional publication counters", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 16)
  getGlobalInMemoryCache().clearCache()
  const baseline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
  baseline.solve()
  expect(baseline.solved).toBeTrue()
  getGlobalInMemoryCache().clearCache()
  const indexed = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
  const stageIndex = indexed.pipelineDef.findIndex((step) => step.solverName === "pipeline9JointDrcRepairSolver")
  const stage = indexed.pipelineDef[stageIndex]
  if (!stage) throw new Error("Missing joint repair stage")
  indexed.pipelineDef[stageIndex] = { ...stage, solverClass: IndexedProjectionOnlyJointSolver as any } as any
  indexed.solve()
  expect(indexed.solved).toBeTrue()
  expect(indexed.failed).toBeFalse()
  expect(indexed.getOutputSimpleRouteJson()).toEqual(baseline.getOutputSimpleRouteJson())
  expect(indexed.getOutputSimplifiedPcbTraces()).toEqual(baseline.getOutputSimplifiedPcbTraces())
  expect(IndexedProjectionOnlyBoundedSolver.projectionsCreated).toBeGreaterThan(1)
  for (const [key, value] of Object.entries(baseline.pipeline9JointDrcRepairSolver!.stats)) {
    if (key.endsWith("TimeMs")) continue
    expect(indexed.pipeline9JointDrcRepairSolver!.stats[key]).toEqual(value)
  }
})
