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
  const localRepair = solver.pipeline9JointDrcRepairSolver!.localDrcRepairSolver!
  const beforeCleanup = evaluateRelaxedDrc({
    ...drcInput,
    routedTraces: localRepair.input.traces,
  })
  const afterCleanup = evaluateRelaxedDrc({
    ...drcInput,
    routedTraces: localRepair.getOutput(),
  })
  // Compare the same routed board on this platform. Native solver output can
  // differ between Linux and macOS; cleanup must still remove real conflicts.
  expect(beforeCleanup.errors.length - afterCleanup.errors.length).toBeGreaterThanOrEqual(10)
  expect(errors.length).toBeLessThanOrEqual(afterCleanup.errors.length)
  expect(
    errors.filter((error) => error.type === "pcb_via_clearance_error").length,
  ).toBeLessThan(
    beforeCleanup.errors.filter(
      (error) => error.type === "pcb_via_clearance_error",
    ).length,
  )
  expect(solver.pipelineDef.at(-1)?.solverName).toBe("powerTraceExpansionSolver")
  expect(localRepair.solved).toBeTrue()

  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
