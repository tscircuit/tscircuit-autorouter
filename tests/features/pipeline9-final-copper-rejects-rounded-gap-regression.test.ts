import { expect, test } from "bun:test"
import { hasNoWorseTraceGapGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/hasNoNewOrWorseCopperErrors"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("rounded DRC messages cannot hide a smaller physical trace gap", (): void => {
  const routes: HighDensityRoute[] = [0, 0.1944].map((y, index) => ({
    connectionName: `trace_${index}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [{ x: -1, y, z: 0 }, { x: 1, y, z: 0 }],
  }))
  const candidate = [routes[0]!, {
    ...routes[1]!,
    route: routes[1]!.route.map((point) => ({ ...point, y: 0.1936 })),
  }]
  const error = {
    type: "pcb_trace_error",
    pcb_trace_id: "trace_0",
    pcb_trace_error_id: "overlap_trace_0_trace_1",
    message: "Trace spacing (gap: 0.094mm)",
  }
  expect(hasNoWorseTraceGapGeometry(routes, candidate, [error])).toBeFalse()
  expect(hasNoWorseTraceGapGeometry(routes, routes, [error])).toBeTrue()
})
