import { expect, spyOn, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("routing difficulty reaches a terminal solver before the high-density phase", (): void => {
  const board: SimpleRouteJson = {
    layerCount: 6,
    minTraceWidth: 0.1,
    bounds: { minX: -8, maxX: 8, minY: -2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 3,
        height: 10,
        layers: ["top", "inner1", "inner2", "inner3", "inner4", "bottom"],
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -5, y: 0, layer: "top" },
          { x: 5, y: 0, layer: "top" },
        ],
      },
    ],
  }
  // Step two enters this phase and also exhausts a one-iteration budget.
  for (const budget of [1, 2]) {
    const boundary = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(board),
      {
        effort: 0.1,
        cacheProvider: null,
      },
    )
    boundary.MAX_ITERATIONS = budget
    if (budget === 1) {
      expect(() =>
        boundary.solveUntilPhase("componentDetectionSolver"),
      ).toThrow("ran out of iterations")
      // Asking again must propagate the same error without taking another step.
      expect(() =>
        boundary.solveUntilPhase("componentDetectionSolver"),
      ).toThrow("ran out of iterations")
    } else {
      boundary.solveUntilPhase("componentDetectionSolver")
    }
    expect(boundary.failed).toBe(budget === 1)
    expect(boundary.iterations).toBe(2)
    expect(boundary.getCurrentPhase()).toBe("componentDetectionSolver")
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(board, {
    effort: 0.1,
    cacheProvider: null,
  })
  // Bound the regression deterministically. A terminal step can never advance the phase.
  const step = solver.step.bind(solver)
  spyOn(solver, "step").mockImplementation((): void => {
    if (solver.failed || solver.solved)
      throw new Error("stepped a terminal solver")
    step()
  })
  expect(() => solver.solveUntilPhase("highDensityRouteSolver")).toThrow(
    "no legal path",
  )
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("no legal path")
})
