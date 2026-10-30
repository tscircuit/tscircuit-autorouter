import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { createHighDensityForceImproveRuntimeFixture } from "tests/fixtures/createHighDensityForceImproveRuntimeFixture"

test("the actual Pipeline9 factory defaults off and enables sparse force work only by explicit option", () => {
  const fixture = createHighDensityForceImproveRuntimeFixture()
  const outputs = []
  for (const requested of [undefined, false, true]) {
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph({
      layerCount: 2,
      minTraceWidth: 0.15,
      bounds: { minX: -3, maxX: 34, minY: -3, maxY: 3 },
      obstacles: [],
      connections: [],
    }, { cacheProvider: null, experimentSparseForce: requested })
    Object.assign(pipeline, {
      highDensityNodePortPoints: fixture.nodeWithPortPoints,
      highDensityRouteSolver: { routes: fixture.hdRoutes },
    })
    const step = pipeline.pipelineDef.find((item) => item.solverName === "highDensityForceImproveSolver")!
    const args = step.getConstructorParams(pipeline) as ConstructorParameters<typeof Pipeline9HighDensityForceImproveSolver>
    expect(Object.hasOwn(args[0], "experimentSparseForce")).toBe(requested === true)
    expect(args[0].totalStepsPerNode).toBe(20)
    const solver = new Pipeline9HighDensityForceImproveSolver(...args)
    expect(solver.sparseForceStats?.activated ?? false).toBe(false)
    solver.solve()
    expect(solver.sparseForceStats?.activated ?? false).toBe(requested === true)
    expect(solver.sparseForceStats?.sampleNodes ?? 0).toBe(requested === true ? 4 : 0)
    outputs.push(solver.getOutput())
  }
  expect(outputs[1]).toEqual(outputs[0])
  expect(outputs[2]).toEqual(outputs[0])
})
