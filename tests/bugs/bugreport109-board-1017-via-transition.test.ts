import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import srjJson from "../../fixtures/bug-reports/bugreport109-board-1017-via-transition/bugreport109-board-1017-via-transition.srj.json" with {
  type: "json",
}

const srj = srjJson as SimpleRouteJson

test("bugreport109 reproduces the missing same-net via transition on board 1017", async (): Promise<void> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )

  while (
    solver.getCurrentPhase() !== "traceSimplificationSolver" &&
    !solver.solved &&
    !solver.failed
  ) {
    solver.step()
  }
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.getCurrentPhase()).toBe("traceSimplificationSolver")
  // Preserve the routed board before the failing simplification mutates it.
  const routedTraces = solver.getNewTracesBeforePowerExpansion()

  // Characterize the reported failure until the underlying solver is fixed.
  const expectedError =
    'SameNetViaMergerSolver could not find route transition for via at (-5.8, -22.1) on route "source_net_0_mst44"'
  expect(() => solver.solve()).toThrow(expectedError)
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toContain(expectedError)
  expect(solver.getCurrentPhase()).toBe("traceSimplificationSolver")

  await expect(
    getBugReportSnapshotSvg({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
