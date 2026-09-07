import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateCoreRoutingDrc } from "lib/testing/evaluate-core-routing-drc"
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
  const { errors } = evaluateCoreRoutingDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  if (errors.length > 0) {
    console.error(
      JSON.stringify(
        {
          errors,
          jointRepairStats: solver.pipeline9JointDrcRepairSolver?.stats,
        },
        null,
        2,
      ),
    )
  }
  expect(errors).toHaveLength(0)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "routed" },
  )
}, 600_000)
