import { expect, test } from "bun:test"
import { createRepair04BenchmarkPipeline } from "../../scripts/benchmark/createRepair04BenchmarkPipeline"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9JointDrcRepairSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { Pipeline9Repair04Solver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("benchmark baseline preserves routes without repair04", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  const originalRoutes = JSON.stringify(fixture.hdRoutes)
  const pipeline = createRepair04BenchmarkPipeline(fixture.srj, "baseline", {
    effort: 1,
    cacheProvider: null,
  })
  const production = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.srj,
  )
  const repairNames = ["repair04Solver", "repair04AdvancedSolver"]
  expect(pipeline.pipelineDef.map((stage): string => stage.solverName)).toEqual(
    production.pipelineDef.map((stage): string => stage.solverName),
  )
  const changedClasses = pipeline.pipelineDef.filter(
    (stage, index): boolean =>
      stage.solverClass !== production.pipelineDef[index]!.solverClass,
  )
  expect(changedClasses.map((stage): string => stage.solverName)).toEqual(
    repairNames,
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
  for (const name of repairNames) {
    const stage = pipeline.pipelineDef.find(
      (entry): boolean => entry.solverName === name,
    )!
    const params = stage.getConstructorParams(
      pipeline,
    ) as ConstructorParameters<typeof Pipeline9Repair04Solver>
    expect(params[0].hdRoutes).toBe(fixture.hdRoutes)
    params[0].referenceDrcEvaluator = (): never => {
      throw new Error("Benchmark baseline must not evaluate reference DRC")
    }
    const BaselineSolver = stage.solverClass as typeof Pipeline9Repair04Solver
    const solver = new BaselineSolver(...params)
    const access = solver as unknown as { engine: { evaluate(): never } }
    access.engine.evaluate = (): never => {
      throw new Error("Benchmark baseline must not evaluate indexed DRC")
    }
    solver.step()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.getOutput()).toBe(fixture.hdRoutes)
    expect(solver.stats.completionReason).toBe("benchmark-baseline")
  }
  const joint = pipeline.pipelineDef.find(
    (stage): boolean => stage.solverName === "pipeline9JointDrcRepairSolver",
  )!
  const productionJoint = production.pipelineDef.find(
    (stage): boolean => stage.solverName === "pipeline9JointDrcRepairSolver",
  )!
  const [params] = joint.getConstructorParams(
    pipeline,
  ) as ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>
  const [productionParams] = productionJoint.getConstructorParams(
    pipeline,
  ) as ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>
  expect(joint.solverClass).toBe(Pipeline9JointDrcRepairSolver)
  expect(productionParams.finalReferenceDrcEvaluator).toBeFunction()
  expect(params).toEqual({
    ...productionParams,
    finalReferenceDrcEvaluator: undefined,
  })
  expect(JSON.stringify(fixture.hdRoutes)).toBe(originalRoutes)
})
