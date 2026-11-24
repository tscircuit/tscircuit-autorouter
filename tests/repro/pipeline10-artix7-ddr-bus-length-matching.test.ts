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
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  // The unrouted board has only single-layer pads. Every layer transition
  // therefore needs a via in the emitted copper.
  expect(
    input.obstacles.every((obstacle) => obstacle.layers.length === 1),
  ).toBe(true)
  expect(
    routedTraces
      .flatMap((trace) => trace.route)
      .filter(
        (point) =>
          point.route_type === "through_obstacle" &&
          point.from_layer !== point.to_layer,
      ),
  ).toEqual([])
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
