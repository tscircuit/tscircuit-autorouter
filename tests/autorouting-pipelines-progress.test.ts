import { expect, test } from "bun:test"
import {
  AssignableAutoroutingPipeline1Solver,
  AssignableAutoroutingPipeline2,
  AssignableAutoroutingPipeline3,
  AutoroutingPipeline1_OriginalUnravel,
  AutoroutingPipelineSolver2_PortPointPathing,
  AutoroutingPipelineSolver3_HgPortPointPathing,
  AutoroutingPipelineSolver4,
  AutoroutingPipelineSolver5,
  AutoroutingPipelineSolver6,
  AutoroutingPipelineSolver7_MultiGraph,
  AutoroutingPipelineSolver8,
  AutoroutingPipelineSolver9_PreloadedTraceGraph,
  AutoroutingPipelineSolver9_Networked,
  type SimpleRouteJson,
} from "lib/index"

test("every legacy autorouting pipeline reports completed stages", async () => {
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
    AssignableAutoroutingPipeline1Solver,
    AssignableAutoroutingPipeline2,
    AssignableAutoroutingPipeline3,
    AutoroutingPipeline1_OriginalUnravel,
    AutoroutingPipelineSolver2_PortPointPathing,
    AutoroutingPipelineSolver3_HgPortPointPathing,
    AutoroutingPipelineSolver4,
    AutoroutingPipelineSolver5,
    AutoroutingPipelineSolver6,
    AutoroutingPipelineSolver7_MultiGraph,
    AutoroutingPipelineSolver8,
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
      if (
        solver instanceof AutoroutingPipelineSolver5 ||
        solver instanceof AutoroutingPipelineSolver9_Networked
      ) {
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
