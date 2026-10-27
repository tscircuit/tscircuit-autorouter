import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { priorityParams } from "../priorityDagTestUtils"

test("Pipeline9 carries declared copper rules through its regular factory without replacing its search margin", (): void => {
  for (const traceGap of [undefined, 0.05, 0.1, 0.3]) {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      defaultObstacleMargin: 0.15,
      minTraceToPadEdgeClearance: traceGap,
      minPadEdgeToPadEdgeClearance: traceGap === 0.3 ? 0.25 : undefined,
      bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
      obstacles: [],
      connections: [{
        name: "a",
        pointsToConnect: [
          { x: -4, y: -1, layer: "top" },
          { x: 4, y: 1, layer: "top" },
        ],
      }],
    }
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
      effort: 1, cacheProvider: null,
    })
    while (!pipeline.highDensityRouteSolver && !pipeline.failed && !pipeline.solved)
      pipeline.step()
    expect(pipeline.failed).toBe(false)
    const highDensity = pipeline.highDensityRouteSolver!
    expect(highDensity).toBeDefined()
    highDensity["startRegularSolver"](priorityParams().nodeWithPortPoints)
    const regular = highDensity.activeRegularSolver!
    expect(regular.obstacleMargin).toBe(0.15)
    expect(regular.priorityDagOptions.actualCopperClearance).toBe(traceGap ?? 0.1)
    expect(regular.priorityDagOptions.actualViaPadClearance).toBe(
      traceGap === 0.3 ? 0.25 : 0.1,
    )
  }
})
