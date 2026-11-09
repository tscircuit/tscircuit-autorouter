import { expect, spyOn, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getConnectionMinimumTraceWidthInput } from "../fixtures/connectionMinimumTraceWidthInput"

test("final validation rejects full-width copper moved into an under-clearance channel", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    getConnectionMinimumTraceWidthInput(),
    { cacheProvider: null },
  )
  while (
    !solver.failed &&
    solver.currentPipelineStepIndex < solver.pipelineDef.length
  )
    solver.step()
  expect(solver.failed).toBe(false)
  const expansion = solver.powerTraceExpansionSolver!
  const invalid = expansion.getOutput().map((trace) => ({
    ...trace,
    route: trace.route.map((point) =>
      point.route_type === "wire" ? { ...point, y: 0, width: 0.4 } : point,
    ),
  }))
  const output = spyOn(expansion, "getOutput").mockReturnValue(invalid)
  try {
    solver.step()
    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    expect(solver.error).toContain(
      "final copper cannot meet minimum trace width 0.4mm",
    )
    expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow(
      "Cannot get output before solving is complete",
    )
  } finally {
    output.mockRestore()
  }
})
