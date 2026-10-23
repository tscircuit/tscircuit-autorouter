import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "../../fixtures/bug-reports/bugreport96-full-gameboy-no-breakout/bugreport96-full-gameboy-no-breakout.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

test("Pipeline9 rejects unresolved DRC in the full Game Boy Advance route", () => {
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

  expect(solver.failed).toBeTrue()
  expect(solver.solved).toBeFalse()
  const finalDrcIssueCount = solver.stats.finalDrcIssueCount
  expect(finalDrcIssueCount).toBeGreaterThan(0)
  expect(solver.error).toBe(
    `Pipeline9 could not produce valid copper: ${finalDrcIssueCount} DRC errors remain`,
  )
  expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow(
    "Cannot get output before solving is complete",
  )
  expect(() => solver.getOutputSimpleRouteJson()).toThrow(
    "Cannot get output before solving is complete",
  )
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
}, 600_000)
