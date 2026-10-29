import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9EffortCleanupSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9EffortCleanupSolver"
import { createJointLayerFixture } from "tests/fixtures/joint-layer-assignment"

test("joint layer assignment requires explicit Pipeline9 activation and leaves default cleanup identical", (): void => {
  const { routes, srj } = createJointLayerFixture()
  const outputs: unknown[] = []
  for (const enabled of [undefined, false, true]) {
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
      cacheProvider: null, experimentJointLayers: enabled,
    })
    // Exercise the real stage factory with synthetic completed prior stages.
    Object.assign(pipeline, {
      srjWithPointPairs: srj,
      netToPointPairsSolver: { newConnections: srj.connections },
      pipeline9JointDrcRepairSolver: {
        getOutput: () => routes, stats: { initialBoundedRegionalRepairAddedViaCount: 0 },
      },
      getUpdatedPreloadedTraces: () => [],
    })
    const stage = pipeline.pipelineDef.find((entry) => entry.solverName === "effortCleanupSolver")!
    const params = stage.getConstructorParams(pipeline)[0] as ConstructorParameters<typeof Pipeline9EffortCleanupSolver>[0]
    expect(params.jointLayerAssignment !== undefined).toBe(enabled === true)
    if (enabled === true) {
      expect(params.jointLayerAssignment!.evaluate(routes).valid).toBe(true)
      const enabledSolver = new Pipeline9EffortCleanupSolver(params)
      enabledSolver.solve()
      expect(enabledSolver.failed).toBe(false)
      expect(enabledSolver.stats.jointLayers.activated).toBe(1)
      expect(enabledSolver.stats.jointLayers.fullValidations).toBeGreaterThan(0)
      continue
    }
    const solver = new Pipeline9EffortCleanupSolver(params)
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.stats.jointLayers).toBeUndefined()
    expect(solver.jointLayerAssignmentSolver).toBeUndefined()
    outputs.push({ routes: solver.getOutput(), iterations: solver.iterations, stats: solver.stats,
      cost: solver.bestCost, passes: solver.completedPasses })
  }
  expect(outputs[0]).toEqual(outputs[1])
})
