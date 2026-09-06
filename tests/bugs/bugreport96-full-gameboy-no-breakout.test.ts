import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "../../fixtures/bug-reports/bugreport96-full-gameboy-no-breakout/bugreport96-full-gameboy-no-breakout.srj.json" with {
  type: "json",
}
import { expectPipeline9FixedRouteContinuity } from "../fixtures/expectPipeline9FixedRouteContinuity"
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
  expect(hdSolver).toBeDefined()
  const protectedConnectionName: string = "source_trace_0_fixed_70_0"
  expectPipeline9FixedRouteContinuity({
    connectionName: protectedConnectionName,
    originalFixedRoutes: hdSolver!.fixedHdRoutes,
    updatedFixedRoutes: hdSolver!.getUpdatedFixedHdRoutes(),
    replacement: hdSolver!.fixedRouteReplacements.get(protectedConnectionName),
    mutationMask: hdSolver!.preloadedTraceMutationMasks.get(
      protectedConnectionName,
    ),
    layerCount: srj.layerCount,
  })
  expect(
    hdSolver!.removedFixedRouteConnectionNames.has(protectedConnectionName),
  ).toBeFalse()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "routed" },
  )
})
