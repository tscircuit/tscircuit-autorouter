import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getTrappedBgaTerminalFixture } from "tests/fixtures/getTrappedBgaTerminalFixture"

test("Pipeline9 still routes a tight BGA with a same-net escape", (): void => {
  const { srj } = getTrappedBgaTerminalFixture()
  srj.obstacles[5]!.connectedTo = ["signal-alias"]
  srj.connections[0]!.__rootConnectionNames = ["signal-alias"]
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
    effort: 1,
  })
  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.componentDetectionSolver!.getOutput()).toContainEqual(
    expect.objectContaining({ componentId: "bga", componentKind: "bga" }),
  )
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(routedTraces.length).toBeGreaterThan(0)
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }).errors,
  ).toEqual([])
})
