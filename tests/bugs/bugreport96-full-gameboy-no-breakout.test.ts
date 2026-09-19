import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
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
  const originalPreloadedTrace = srj.traces![70]!
  const updatedPreloadedTrace = solver.getUpdatedPreloadedTraces().find(
    (trace) => trace.pcb_trace_id === originalPreloadedTrace.pcb_trace_id,
  )
  expect(updatedPreloadedTrace).toBeDefined()
  // Hypergraph rerouting may materialize this section before high-density
  // routing. Its final copper must still connect the same MCU pads.
  expect(updatedPreloadedTrace!.route[0]).toMatchObject(
    originalPreloadedTrace.route[0],
  )
  expect(updatedPreloadedTrace!.route.at(-1)).toMatchObject(
    originalPreloadedTrace.route.at(-1),
  )
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "routed" },
  )
}, 600_000)
