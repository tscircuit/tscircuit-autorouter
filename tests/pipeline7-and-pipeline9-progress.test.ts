import { expect, test } from "bun:test"
import {
  AutoroutingPipelineSolver7_MultiGraph,
  AutoroutingPipelineSolver9_Networked,
  AutoroutingPipelineSolver9_PreloadedTraceGraph,
  type SimpleRouteJson,
} from "lib/index"

test("Pipeline7, Pipeline9, and Pipeline9 Networked report progress", async () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 1, y: 2, layer: "top" },
          { x: 9, y: 8, layer: "top" },
        ],
      },
    ],
  }

  for (const Solver of [
    AutoroutingPipelineSolver7_MultiGraph,
    AutoroutingPipelineSolver9_PreloadedTraceGraph,
    AutoroutingPipelineSolver9_Networked,
  ]) {
    const solver = new Solver(structuredClone(input))
    expect(solver.progress).toBe(0)
    while (
      solver.currentPipelineStepIndex === 0 &&
      !solver.solved &&
      !solver.failed
    ) {
      if (solver instanceof AutoroutingPipelineSolver9_Networked) {
        await solver.stepAsync()
      } else {
        solver.step()
      }
    }

    expect(solver.failed).toBe(false)
    expect(solver.progress).toBeGreaterThan(0)
    expect(solver.progress).toBeLessThan(1)
  }
})
