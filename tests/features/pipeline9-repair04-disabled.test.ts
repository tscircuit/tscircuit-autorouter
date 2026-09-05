import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("enableRepair04 false wires an unchanged passthrough without reference evaluation", () => {
  const fixture = createPipeline9Repair04Fixture()
  const originalRoutes = structuredClone(fixture.hdRoutes)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(fixture.srj, {
    enableRepair04: false,
  })
  const definition = pipeline.pipelineDef.find((step) => step.solverName === "repair04Solver")!
  const [params] = definition.getConstructorParams({
    ...pipeline,
    getSrjWithMaterializedPreloadedTraces: () => fixture.srj,
    getPreloadedTraceUpdatesAfterHighDensity: () => ({ mutatedPreloadedTraces: [] }),
    globalDrcForceImproveSolver: { getOutput: () => fixture.hdRoutes },
    netToPointPairsSolver: { newConnections: fixture.srj.connections },
  }) as ConstructorParameters<typeof Pipeline9Repair04Solver>
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
