import { expect, test } from "bun:test"
import {
  AutoroutingPipelineSolver4,
  AutoroutingPipelineSolver5,
  AutoroutingPipelineSolver6,
  AutoroutingPipelineSolver7_MultiGraph,
  AutoroutingPipelineSolver8,
  AutoroutingPipelineSolver9_Networked,
  AutoroutingPipelineSolver9_PreloadedTraceGraph,
} from "lib"
import type { SimpleRouteJson } from "lib/types"

test("routing pipelines reject out-of-bounds terminals before building the graph", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 3, y: 0, layer: "top", pointId: "outside" },
        ],
      },
    ],
  }

  for (const Solver of [
    AutoroutingPipelineSolver4,
    AutoroutingPipelineSolver5,
    AutoroutingPipelineSolver6,
    AutoroutingPipelineSolver7_MultiGraph,
    AutoroutingPipelineSolver8,
    AutoroutingPipelineSolver9_PreloadedTraceGraph,
    AutoroutingPipelineSolver9_Networked,
  ]) {
    const solver = new Solver(srj)
    expect(() => solver.step()).toThrow(
      'Connection "signal" point "outside" at (3, 0) is outside routing bounds: x [-2, 2], y [-2, 2]',
    )
    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    expect(solver.error).toContain("outside routing bounds")
    expect(solver.activeSubSolver).toBeNull()
    expect(solver.getCurrentPhase()).toBe("preprocessSimpleRouteJsonSolver")
    solver.step()
    expect(solver.iterations).toBe(1)
  }
})
