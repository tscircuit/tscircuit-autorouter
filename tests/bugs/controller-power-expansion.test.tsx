import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { combinePreloadedAndRoutedTraces } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import srjJson from "../../fixtures/bug-reports/controller-power-expansion/controller-power-expansion.srj.json" with {
  type: "json",
}
import fullBoardSrjJson from "../../fixtures/bug-reports/controller-power-expansion/controller-full-board.srj.json" with {
  type: "json",
}

const srj = srjJson as SimpleRouteJson
const fullBoardSrj = fullBoardSrjJson as SimpleRouteJson
const SOLVER_STEPS_PER_YIELD = 256

test("controller power expansion records uncached stepping and the full board", async (): Promise<void> => {
  // Exact solver input and full-board context from the controller's v0.0.9 JOINT_LV phase.
  expect(fullBoardSrj.bounds).toEqual({ minX: -24, maxX: 24, minY: -25, maxY: 25 })
  expect(fullBoardSrj.obstacles).toHaveLength(71)
  expect(fullBoardSrj.traces).toHaveLength(5)
  expect(srj.bounds).toEqual({ minX: -24, maxX: 24, minY: -3, maxY: 25 })
  expect(srj.obstacles).toHaveLength(86)
  expect(srj.connections).toHaveLength(14)
  expect(srj.traces).toHaveLength(0)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { effort: 1, cacheProvider: null },
  )
  const startedAt = performance.now()
  let yieldCount = 0
  while (!solver.solved && !solver.failed) {
    for (
      let stepIndex = 0;
      stepIndex < SOLVER_STEPS_PER_YIELD && !solver.solved && !solver.failed;
      stepIndex++
    ) {
      solver.step()
    }
    if (!solver.solved && !solver.failed) {
      yieldCount++
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }

  expect(solver.failed, `Pipeline9 failed: ${solver.error}`).toBe(false)
  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(routedTraces).toHaveLength(37)
  const physicalViaPadDiameter = fullBoardSrj.minViaPadDiameter
  const physicalViaHoleDiameter = fullBoardSrj.minViaHoleDiameter
  if (physicalViaPadDiameter === undefined || physicalViaHoleDiameter === undefined) {
    throw new Error("The captured board must declare its physical via dimensions")
  }
  // Match the published adapter's 0.84 mm planning vias to its physical 0.6/0.3 mm vias.
  for (const trace of routedTraces) {
    for (const point of trace.route) {
      if (point.route_type === "via") {
        point.via_diameter = physicalViaPadDiameter
        point.via_hole_diameter = physicalViaHoleDiameter
      }
    }
  }
  const completeTraces = combinePreloadedAndRoutedTraces(
    fullBoardSrj.traces ?? [],
    routedTraces,
  )
  expect(completeTraces).toHaveLength(42)
  const powerExpansion = solver.powerTraceExpansionSolver
  const srjWithPointPairs = solver.srjWithPointPairs
  if (!powerExpansion || !srjWithPointPairs) {
    throw new Error("Pipeline9 did not reach power expansion with point pairs")
  }
  expect(powerExpansion.powerTraceExpanderSolver.iterations).toBeGreaterThan(0)
  console.log({
    routingMs: performance.now() - startedAt,
    powerExpansionMs: solver.timeSpentOnPhase.powerTraceExpansionSolver,
    powerWrapperIterations: powerExpansion.iterations,
    powerInnerIterations: powerExpansion.powerTraceExpanderSolver.iterations,
    yieldCount,
  })

  await expect(
    getBugReportSnapshotSvg({
      inputSrj: fullBoardSrj,
      srjWithPointPairs,
      routedTraces,
      drcOptions: {
        traceClearance: fullBoardSrj.minTraceToPadEdgeClearance,
        viaClearance: fullBoardSrj.minPadEdgeToPadEdgeClearance,
      },
      includeBoardClearance: true,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
