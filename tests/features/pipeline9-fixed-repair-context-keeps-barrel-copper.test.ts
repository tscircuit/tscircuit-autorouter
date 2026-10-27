import { expect, test } from "bun:test"
import { getPipeline9FixedPreloadedRepairTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9FixedPreloadedRepairTraces"
import type { SimplifiedPcbTrace } from "lib/types"

test("fixed repair context retains barrel layers and authoritative drilled vias", (): void => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "existing",
    connection_name: "signal",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.2, layer: "top" },
      { route_type: "wire", x: 0.2, y: 0, width: 0.2, layer: "top" },
      {
        route_type: "through_obstacle",
        start: { x: 0.2, y: 0 },
        end: { x: 0.4, y: 0 },
        from_layer: "top",
        to_layer: "bottom",
        width: 0.2,
      },
      { route_type: "wire", x: 0.4, y: 0, width: 0.2, layer: "bottom" },
      { route_type: "wire", x: 1, y: 0, width: 0.2, layer: "bottom" },
      {
        route_type: "via",
        x: 1,
        y: 0,
        from_layer: "bottom",
        to_layer: "inner2",
        layers: ["top", "inner1", "inner2", "bottom"],
        via_diameter: 0.6,
        via_hole_diameter: 0.27,
      },
      { route_type: "wire", x: 1, y: 0, width: 0.2, layer: "inner2" },
      { route_type: "wire", x: 2, y: 0, width: 0.2, layer: "inner2" },
    ],
  }
  const original = structuredClone(trace)
  const fixed = getPipeline9FixedPreloadedRepairTraces({
    traces: [trace],
    layerCount: 4,
  })
  expect(fixed).toHaveLength(6)
  expect(
    fixed.every((section) => section.connection_name === "signal"),
  ).toBeTrue()
  expect(fixed.slice(1, 5).map((section) => section.route)).toEqual(
    ["top", "inner1", "inner2", "bottom"].map((layer) => [
      { route_type: "wire", x: 0.2, y: 0, width: 0.2, layer },
      { route_type: "wire", x: 0.4, y: 0, width: 0.2, layer },
    ]),
  )
  const drilledVias = fixed.flatMap((section) =>
    section.route.filter((point) => point.route_type === "via"),
  )
  expect(drilledVias).toEqual(
    original.route.filter((point) => point.route_type === "via"),
  )
  expect(trace).toEqual(original)
})
