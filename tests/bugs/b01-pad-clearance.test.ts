import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import phaseInput from "../../fixtures/bug-reports/b01-pad-clearance/b01-pad-clearance.srj.json" with {
  type: "json",
}

test("B01 pad escape with preloaded copper", async (): Promise<void> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    phaseInput as SimpleRouteJson,
  )
  let padEscapeSolver = solver.highDensityRouteSolver?.activeB01Solver
  while (!solver.solved && !solver.failed) {
    solver.step()
    const activeB01 = solver.highDensityRouteSolver?.activeB01Solver
    if (activeB01) padEscapeSolver = activeB01
  }

  expect(solver.solved).toBeTrue()
  if (!padEscapeSolver) throw new Error("Expected B01 to route the pad escape")
  // Later routing stages recover the escape, so capture B01's local result.
  const svg = getSvgFromGraphicsObject(padEscapeSolver.visualize(), {
    backgroundColor: "white",
    includeTextLabels: false,
  }).replace(/[ \t]+$/gm, "")
  await expect(svg).toMatchSvgSnapshot(import.meta.path, { tolerance: 0.001 })
  expect(padEscapeSolver.obstacles).toContainEqual(
    expect.objectContaining({
      type: "rect",
      traceClearanceMargin: phaseInput.minTraceToPadEdgeClearance,
      viaClearanceMargin: phaseInput.minViaEdgeToPadEdgeClearance,
    }),
  )
  expect(padEscapeSolver.solved).toBeTrue()
  expect(solver.highDensityRouteSolver?.failedSolvers).toHaveLength(0)
})
