import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport107-board-1726/bugreport107-board-1726.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport107-board-1726.json with Pipeline 9", async (): Promise<void> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
  )
  solver.solve()

  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)

  const drcInput = {
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }
  const { errors } = evaluateRelaxedDrc(drcInput)
  const beforeCleanup = evaluateRelaxedDrc({
    ...drcInput,
    routedTraces: solver.localDrcRepairSolver!.input.traces,
  })
  // Compare the same routed board on this platform. Native solver output can
  // differ between Linux and macOS; cleanup must still remove real conflicts.
  expect(beforeCleanup.errors.length - errors.length).toBeGreaterThanOrEqual(10)
  expect(
    errors.filter((error) => error.type === "pcb_via_clearance_error").length,
  ).toBeLessThan(
    beforeCleanup.errors.filter(
      (error) => error.type === "pcb_via_clearance_error",
    ).length,
  )

  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
