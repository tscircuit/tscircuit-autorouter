import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "../../fixtures/bug-reports/bugreport96-full-gameboy-no-breakout/bugreport96-full-gameboy-no-breakout.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

test("Pipeline9 routes the full Game Boy Advance parent directly to MCU pads", (): void => {
  const srj: SimpleRouteJson = structuredClone(
    simpleRouteJson,
  ) as SimpleRouteJson
  const solver: AutoroutingPipelineSolver9_PreloadedTraceGraph =
    new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
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
  const hdSolver: Pipeline9HighDensitySolver | undefined =
    solver.highDensityRouteSolver
  const protectedConnectionName: string = "source_trace_0_fixed_70_0"
  const replacement: PreloadedHighDensityRoute | undefined =
    hdSolver?.fixedRouteReplacements.get(protectedConnectionName)
  if (hdSolver && replacement) {
    const originalFixedRoute: PreloadedHighDensityRoute | undefined =
      hdSolver.fixedHdRoutes.find(
        (route: PreloadedHighDensityRoute): boolean =>
          route.connectionName === protectedConnectionName,
      )
    const diagnostic: string = JSON.stringify(
      {
        protectedConnectionName,
        originalFixedRoute,
        originalPreloadedTrace: srj.traces?.[replacement.preloadedTraceIndex],
        replacement,
        mutationMask: hdSolver.preloadedTraceMutationMasks.get(
          protectedConnectionName,
        ),
        markedRemoved: hdSolver.removedFixedRouteConnectionNames.has(
          protectedConnectionName,
        ),
      },
      null,
      2,
    )
    console.error("Gameboy96 protected fixed-route replacement", diagnostic)
  }
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
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "routed" },
  )
})
