import { expect, test } from "bun:test"
import { createRepair04BenchmarkPipeline } from "../../scripts/benchmark/createRepair04BenchmarkPipeline"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9JointDrcRepairSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { Pipeline9Repair04Solver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("benchmark candidate uses the production pipeline", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  const options = { effort: 1, cacheProvider: null }
  const pipeline = createRepair04BenchmarkPipeline(
    fixture.srj,
    "candidate",
    options,
  )
  const production = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.srj,
    options,
  )
  expect(pipeline.constructor).toBe(
    AutoroutingPipelineSolver9_PreloadedTraceGraph,
  )
  expect(
    pipeline.pipelineDef.map(
      ({ solverName, solverClass }): [string, unknown] => [
        solverName,
        solverClass,
      ],
    ),
  ).toEqual(
    production.pipelineDef.map(
      ({ solverName, solverClass }): [string, unknown] => [
        solverName,
        solverClass,
      ],
    ),
  )
  Object.assign(pipeline, {
    srj: fixture.srj,
    srjWithPointPairs: fixture.srj,
    netToPointPairsSolver: { newConnections: fixture.srj.connections },
    globalDrcForceImproveSolver: {
      getOutput: (): typeof fixture.hdRoutes => fixture.hdRoutes,
    },
    repair04Solver: {
      getOutput: (): typeof fixture.hdRoutes => fixture.hdRoutes,
    },
    pipeline9JointDrcRepairSolver: {
      getOutput: (): typeof fixture.hdRoutes => fixture.hdRoutes,
    },
    getSrjWithMaterializedPreloadedTraces: (): typeof fixture.srj =>
      fixture.srj,
    getPreloadedTraceUpdatesAfterHighDensity: (): {
      updatedPreloadedTraces: typeof fixture.srj.traces
      mutatedPreloadedTraces: typeof fixture.srj.traces
    } => ({
      updatedPreloadedTraces: fixture.srj.traces,
      mutatedPreloadedTraces: [],
    }),
    getUpdatedPreloadedTraces: (): typeof fixture.srj.traces =>
      fixture.srj.traces,
    getMutatedPreloadedTraces: (): typeof fixture.srj.traces => [],
  })
  const joint = pipeline.pipelineDef.find(
    (stage): boolean => stage.solverName === "pipeline9JointDrcRepairSolver",
  )!
  const [jointParams] = joint.getConstructorParams(
    pipeline,
  ) as ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>
  expect(jointParams.finalReferenceDrcEvaluator).toBeFunction()
  expect(jointParams.newHdRoutes).toBe(fixture.hdRoutes)
  for (const name of ["repair04Solver", "repair04AdvancedSolver"]) {
    const stage = pipeline.pipelineDef.find(
      (entry): boolean => entry.solverName === name,
    )!
    expect(stage.solverClass).toBe(Pipeline9Repair04Solver)
    const [params] = stage.getConstructorParams(
      pipeline,
    ) as ConstructorParameters<typeof Pipeline9Repair04Solver>
    let referenceCalls = 0
    params.referenceDrcEvaluator = (): [] => {
      referenceCalls++
      return []
    }
    const solver = new Pipeline9Repair04Solver(params)
    solver.step()
    expect(referenceCalls).toBe(1)
    expect(solver.solved).toBe(true)
    expect(solver.stats.completionReason).toBe("clean")
  }
})
