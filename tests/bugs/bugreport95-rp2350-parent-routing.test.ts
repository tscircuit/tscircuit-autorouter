import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import bugReport from "../../fixtures/bug-reports/bugreport95-rp2350-parent-routing/bugreport95-rp2350-parent-routing.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson
const reproduceParentRoutingFailure =
  process.env.RUN_RP2350_PARENT_ROUTING_FAILURE === "1"

/**
 * This is the exact parent-phase SRJ captured by tscircuit/core PR #3314 after
 * the MCU subcircuit finishes routing. The 37 child traces are preloaded, and
 * the parent router must connect the remaining 33 board traces around them.
 *
 * Run the full failing Pipeline 9 solve with:
 *
 * RUN_RP2350_PARENT_ROUTING_FAILURE=1 bun test --timeout 9999999 \
 *   tests/bugs/bugreport95-rp2350-parent-routing.test.ts
 */
test("Pipeline 9 routes the RP2350 parent around preserved child traces", () => {
  expect(srj.connections).toHaveLength(33)
  expect(srj.obstacles).toHaveLength(165)
  expect(srj.traces).toHaveLength(37)
  expect(
    getSvgFromGraphicsObject(convertSrjToGraphicsObject(srj), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)

  if (!reproduceParentRoutingFailure) return

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    {
      cacheProvider: null,
      effort: 1,
    },
  )

  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
})
