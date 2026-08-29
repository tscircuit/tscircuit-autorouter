import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "../../fixtures/bug-reports/bugreport96-full-gameboy-no-breakout/bugreport96-full-gameboy-no-breakout.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

test("Pipeline9 routes the full Game Boy Advance parent directly to MCU pads", () => {
  const srj = structuredClone(simpleRouteJson) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
    effort: 1,
  })

  expect(srj.connections).toHaveLength(21)
  expect(srj.obstacles).toHaveLength(379)
  expect(srj.traces).toHaveLength(136)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "unrouted" },
  )

  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(
    solver.highDensityRouteSolver?.fixedRouteReplacements.has(
      "source_trace_0_fixed_70_0",
    ),
  ).toBeFalse()
  expect(
    solver.highDensityRouteSolver
      ?.getUpdatedFixedHdRoutes()
      .some((route) => route.connectionName === "source_trace_0_fixed_70_0"),
  ).toBeTrue()

  const routedSnapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    routedSnapshotPath,
    { svgName: "routed" },
  )
}, 600_000)
