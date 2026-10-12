import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import board from "../../fixtures/bug-reports/bugreport109-board-687/bugreport109-board-687.srj.json" with {
  type: "json",
}

const srj = board as SimpleRouteJson

test("bugreport109-board-687", async (): Promise<void> => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj))
  solver.solve()

  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
