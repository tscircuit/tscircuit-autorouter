import { expect, test } from "bun:test"
import {
  combineHybridBenchmarkRouteGeometry,
  measureHybridBenchmarkRouteGeometry,
} from "scripts/hybrid-benchmark/route-geometry"
import type { SimplifiedPcbTrace } from "lib/types"

test("combines preserved input and generated geometry for production comparisons", () => {
  const createTrace = (
    pcbTraceId: string,
    viaXCoordinates: readonly number[],
  ): SimplifiedPcbTrace => ({
    type: "pcb_trace",
    pcb_trace_id: pcbTraceId,
    connection_name: pcbTraceId,
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      ...viaXCoordinates.map((x) => ({
        route_type: "via" as const,
        x,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
      })),
      { route_type: "wire", x: 4, y: 0, width: 0.1, layer: "bottom" },
    ],
  })
  const preserved = measureHybridBenchmarkRouteGeometry([
    createTrace("preserved", [1]),
  ])
  const generated = measureHybridBenchmarkRouteGeometry([
    createTrace("generated", [2, 3]),
  ])

  expect(
    combineHybridBenchmarkRouteGeometry(preserved, generated).viaCount,
  ).toBe(3)
})
