import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("enableRepair04 false wires an unchanged passthrough without reference evaluation", () => {
  const fixture = createPipeline9Repair04Fixture()
  const originalRoutes = structuredClone(fixture.hdRoutes)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.srj,
    {
      enableRepair04: false,
    },
  )
  const definition = pipeline.pipelineDef.find(
    (step) => step.solverName === "repair04Solver",
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
  stageAccess.getSrjWithMaterializedPreloadedTraces = () => fixture.srj
  stageAccess.getPreloadedTraceUpdatesAfterHighDensity = () => ({
    updatedPreloadedTraces: fixture.srj.traces,
    mutatedPreloadedTraces: [],
  })
  stageAccess.globalDrcForceImproveSolver = {
    getOutput: () => fixture.hdRoutes,
  }
  stageAccess.netToPointPairsSolver = {
    newConnections: fixture.srj.connections,
  }
  const [params] = definition.getConstructorParams(
    pipeline,
  ) as ConstructorParameters<typeof Pipeline9Repair04Solver>
  expect(params.enabled).toBe(false)
  params.referenceDrcEvaluator = (): never => {
    throw new Error("Disabled repair04 must not evaluate reference DRC")
  }
  const solver = new Pipeline9Repair04Solver(params)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.getOutput()).toEqual(originalRoutes)
  expect(fixture.hdRoutes).toEqual(originalRoutes)
})
