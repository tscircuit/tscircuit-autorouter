import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  minViaDiameter: 0.3,
  obstacles: [],
  connections: [],
  bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
}

test("Pipeline7 rejects synchronous solve when high-density parallelism is enabled", () => {
  const pipeline = new AutoroutingPipelineSolver7_MultiGraph(srj, {
    highDensitySolverParallelism: 2,
  })

  expect(() => pipeline.solve()).toThrow(
    "requires async execution when highDensitySolverParallelism is greater than 1",
  )
})
