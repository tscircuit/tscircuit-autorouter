import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver10_BgaFanout } from "../../lib"
import { getBugReportSnapshotSvg } from "../../lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "../../lib/types"

test("completes Artix-7 DDR bus tuning", async () => {
  const input: SimpleRouteJson = await Bun.file(
    new URL(
      import.meta.resolve(
        "@tscircuit/dataset-srj29-ddr3-bga-pairs/samples/sample014.json",
      ),
    ),
  ).json()
  const solver = new AutoroutingPipelineSolver10_BgaFanout(input, { effort: 1 })
  solver.solve()

  expect(solver.solved).toBe(true)
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
