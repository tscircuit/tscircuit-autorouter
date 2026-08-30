import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport18-1b2d06/bugreport18-1b2d06.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport18-1b2d06.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    snapshotPath,
  )

  const simplifiedTraces = solver.getOutputSimplifiedPcbTraces()
  const viaCount = simplifiedTraces
    .flatMap((trace) => trace.route)
    .filter((segment) => segment.route_type === "via").length

  expect(viaCount).toBe(0)
})
