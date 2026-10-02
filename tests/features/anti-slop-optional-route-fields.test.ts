import { expect, test } from "bun:test"
import { convertSimplifiedPcbTraceToHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/convertSimplifiedPcbTraceToHighDensityRoute"
import type { SimplifiedPcbTrace } from "lib/types"

test("explicit route assembly preserves optional-property omission, insertion order and metadata identity", () => {
  const options = {
    layerCount: 2,
    defaultTraceThickness: 0.15,
    defaultViaDiameter: 0.4,
    rootConnectionName: "signal",
  }
  const transition: Extract<
    SimplifiedPcbTrace["route"][number],
    { route_type: "through_obstacle" }
  > = {
    route_type: "through_obstacle",
    start: { x: 1, y: 2 },
    end: { x: 3, y: 4 },
    from_layer: "top",
    to_layer: "bottom",
    width: 0.2,
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "trace1",
    connection_name: "signal",
    route: [transition],
  }
  const without = convertSimplifiedPcbTraceToHighDensityRoute(trace, options)
  expect(Object.hasOwn(without, "jumpers")).toBe(false)
  expect(
    Object.hasOwn(without.route[0]!, "toNextSegmentCircuitJsonMetadata"),
  ).toBe(false)
  expect(without.route).toEqual([
    {
      x: 1,
      y: 2,
      z: 0,
      traceThickness: 0.2,
      toNextSegmentType: "through_obstacle",
    },
    { x: 3, y: 4, z: 1, traceThickness: 0.2 },
  ])

  const metadata = { pcb_plated_hole_id: "hole1" }
  const jumper: Extract<
    SimplifiedPcbTrace["route"][number],
    { route_type: "jumper" }
  > = {
    route_type: "jumper",
    start: { x: 5, y: 6 },
    end: { x: 7, y: 8 },
    footprint: "0603",
    layer: "top",
  }
  const withFields = convertSimplifiedPcbTraceToHighDensityRoute(
    {
      ...trace,
      route: [{ ...transition, circuitJsonMetadata: metadata }, jumper],
    },
    options,
  )
  expect(withFields.route[0]!.toNextSegmentCircuitJsonMetadata).toBe(metadata)
  expect(Object.keys(withFields.route[0]!)).toEqual([
    "x",
    "y",
    "z",
    "traceThickness",
    "toNextSegmentType",
    "toNextSegmentCircuitJsonMetadata",
  ])
  expect(Object.keys(withFields).at(-1)).toBe("jumpers")
  expect(withFields.jumpers).toEqual([
    {
      route_type: "jumper",
      start: { x: 5, y: 6 },
      end: { x: 7, y: 8 },
      footprint: "0603",
    },
  ])
  expect(withFields.jumpers![0]!.start).not.toBe(jumper.start)
  expect(withFields.jumpers![0]!.end).not.toBe(jumper.end)
})
