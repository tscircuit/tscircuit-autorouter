import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("repair04 runs with default Pipeline9 options and validates a repaired region against reference DRC", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  const originalRoutes = structuredClone(fixture.hdRoutes)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.srj,
    { cacheProvider: null },
  )
  pipeline.srjWithPointPairs = fixture.srj
  expect(
    pipeline.pipelineDef
      .filter(
        (step): boolean =>
          step.solverName === "repair04Solver" ||
          step.solverName === "repair04AdvancedSolver",
      )
      .map((step): string => step.solverName),
  ).toEqual(["repair04Solver", "repair04AdvancedSolver"])
  const definition = pipeline.pipelineDef.find(
    (step): boolean => step.solverName === "repair04Solver",
  )!
  type Fixture = ReturnType<typeof createPipeline9Repair04Fixture>
  const stageAccess = pipeline as unknown as {
    getSrjWithMaterializedPreloadedTraces(): Fixture["srj"]
    getPreloadedTraceUpdatesAfterHighDensity(): {
      updatedPreloadedTraces: Fixture["srj"]["traces"]
      mutatedPreloadedTraces: Fixture["srj"]["traces"]
    }
    globalDrcForceImproveSolver: { getOutput(): Fixture["hdRoutes"] }
    netToPointPairsSolver: { newConnections: Fixture["srj"]["connections"] }
  }
  stageAccess.getSrjWithMaterializedPreloadedTraces = (): Fixture["srj"] =>
    fixture.srj
  stageAccess.getPreloadedTraceUpdatesAfterHighDensity = (): ReturnType<
    typeof stageAccess.getPreloadedTraceUpdatesAfterHighDensity
  > => ({
    updatedPreloadedTraces: fixture.srj.traces,
    mutatedPreloadedTraces: [],
  })
  stageAccess.globalDrcForceImproveSolver = {
    getOutput: (): Fixture["hdRoutes"] => fixture.hdRoutes,
  }
  stageAccess.netToPointPairsSolver = {
    newConnections: fixture.srj.connections,
  }
  const [params] = definition.getConstructorParams(
    pipeline,
  ) as ConstructorParameters<typeof Pipeline9Repair04Solver>
  const evaluateReference = params.referenceDrcEvaluator
  let referenceEvaluations = 0
  params.referenceDrcEvaluator = (input): ReturnType<typeof evaluateReference> => {
    referenceEvaluations++
    return evaluateReference(input)
  }
  const solver = new Pipeline9Repair04Solver(params)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(referenceEvaluations).toBeGreaterThanOrEqual(2)
  expect(solver.stats.acceptedRegions).toBeGreaterThan(0)
  expect(solver.stats.referenceErrors).toBe(0)
  expect(solver.stats.completionReason).toBe("clean")
  const output = solver.getOutput()
  expect(output).not.toEqual(originalRoutes)
  expect(output[0]!.route[0]).toEqual(originalRoutes[0]!.route[0])
  expect(output[0]!.route.at(-1)).toEqual(originalRoutes[0]!.route.at(-1))
  expect(output[1]).toEqual(originalRoutes[1])
  expect(fixture.hdRoutes).toEqual(originalRoutes)
  pipeline.repair04Solver = solver
  const jointDefinition = pipeline.pipelineDef.find(
    (step): boolean => step.solverName === "pipeline9JointDrcRepairSolver",
  )!
  const [jointParams] = jointDefinition.getConstructorParams(
    pipeline,
  ) as ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>
  expect(jointParams.newHdRoutes).toBe(output)
  expect(jointParams.finalReferenceDrcEvaluator).toBeFunction()
  const finalOutput = {
    newHdRoutes: output,
    updatedPreloadedTraces: fixture.srj.traces,
    mutatedPreloadedTraces: [],
  }
  expect(jointParams.finalReferenceDrcEvaluator!(finalOutput)).toBe(0)
  expect(
    jointParams.finalReferenceDrcEvaluator!({
      ...finalOutput,
      newHdRoutes: originalRoutes,
    }),
  ).toBeGreaterThan(0)
})
