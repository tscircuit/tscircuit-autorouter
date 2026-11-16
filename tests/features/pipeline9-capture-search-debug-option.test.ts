import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 forwards its search debug selection to detailed routing", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
    ],
  }
  for (const captureSearchDebug of [undefined, false, true]) {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(input),
      { captureSearchDebug },
    )
    while (!solver.highDensityRouteSolver && !solver.failed && !solver.solved) {
      solver.step()
    }
    expect(solver.failed).toBeFalse()
    const highDensity = solver.highDensityRouteSolver
    expect(highDensity).toBeDefined()
    highDensity!.step()
    expect(highDensity!.activeRegularSolver?.captureSearchDebug).toBe(
      captureSearchDebug ?? false,
    )
  }
})
