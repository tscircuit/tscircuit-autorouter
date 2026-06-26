import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver8 } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport60-fe53a2/bugreport60-fe53a2.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport60-fe53a2.json solves with pipeline8 rust wasm pathing", () => {
  const solver = new AutoroutingPipelineSolver8(srj)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.portPointPathingSolver?.getSolverName()).toBe(
    "RustWasmPortPointPathingSolver",
  )
  expect(solver.getOutputSimplifiedPcbTraces().length).toBeGreaterThan(0)

  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(snapshotPath)
}, 30_000)
