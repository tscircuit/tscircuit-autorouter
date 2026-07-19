import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline7 runs post-DRC simplification only above effort one", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    {
      layerCount: 2,
      minTraceWidth: 0.1,
      bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
      obstacles: [],
      connections: [],
    } as SimpleRouteJson,
    { effort: 1, cacheProvider: null },
  )
  const stage = solver.pipelineDef.find(
    (entry) => entry.solverName === "postDrcTraceSimplificationSolver",
  )

  if (!stage?.shouldRun) {
    throw new Error("Expected an optional post-DRC simplification stage")
  }

  expect(stage.shouldRun(solver)).toBe(false)
  solver.effort = 2
  expect(stage.shouldRun(solver)).toBe(true)
})
