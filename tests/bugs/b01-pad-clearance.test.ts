import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { SimpleRouteJson } from "lib/types"
import phaseInput from "../../fixtures/bug-reports/b01-pad-clearance/b01-pad-clearance.srj.json" with {
  type: "json",
}

test("B01 pad escape with preloaded copper", async (): Promise<void> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    phaseInput as SimpleRouteJson,
  )
  // The whole pipeline can recover this escape through regional routing.
  // Disable that option in the high-density step to exercise B01 itself.
  type HighDensityStep = Extract<
    (typeof solver.pipelineDef)[number],
    { solverClass: typeof Pipeline9HighDensitySolver }
  >
  const highDensityStep = solver.pipelineDef.find(
    (step): step is HighDensityStep =>
      step.solverClass === Pipeline9HighDensitySolver,
  )
  if (!highDensityStep) {
    throw new Error("Expected the high-density routing step")
  }
  const getConstructorParams = highDensityStep.getConstructorParams
  highDensityStep.getConstructorParams = (pipeline) => {
    const [params] = getConstructorParams(pipeline)
    return [{ ...params, enableRegionalFallback: false }]
  }
  let padEscapeSolver = solver.highDensityRouteSolver?.activeB01Solver
  while (!solver.solved && !solver.failed) {
    solver.step()
    const activeB01 = solver.highDensityRouteSolver?.activeB01Solver
    if (activeB01) padEscapeSolver = activeB01
  }

  expect(solver.solved).toBeTrue()
  if (!padEscapeSolver) throw new Error("Expected B01 to route the pad escape")
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
  expect(
    solver.highDensityRouteSolver?.failedSolvers.find(
      (attempt) =>
        attempt.nodeWithPortPoints.capacityMeshNodeId ===
        padEscapeSolver.nodeWithPortPoints.capacityMeshNodeId,
    )?.failureReason,
  ).toBe("no_path")
})
