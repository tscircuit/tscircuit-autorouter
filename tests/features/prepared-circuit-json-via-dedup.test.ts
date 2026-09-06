import { expect, test } from "bun:test"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import {
  convertToCircuitJson,
  createPreparedCircuitJsonConverter,
} from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

const createViaTrace = (
  pcbTraceId: string,
  x: number,
  diameter: number,
  holeDiameter: number,
): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: pcbTraceId,
  connection_name: pcbTraceId,
  route: [
    { route_type: "wire", x, y: 0, layer: "top", width: 0.1 },
    {
      route_type: "via",
      x,
      y: 0,
      from_layer: "top",
      to_layer: "bottom",
      via_diameter: diameter,
      via_hole_diameter: holeDiameter,
    },
    { route_type: "wire", x, y: 0, layer: "bottom", width: 0.1 },
  ],
})

test("prepared circuit JSON preserves exposed via winners, global numbering and official DRC", (): void => {
  const first = createViaTrace("A", 0, 0.3, 0.1)
  const hidden = createViaTrace("B", 0, 0.9, 0.45)
  const distant = createViaTrace("D", 10, 0.3, 0.15)
  const fixed: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fixed_wire",
    connection_name: "fixed_wire",
    route: [
      { route_type: "wire", x: -1, y: 0.4, layer: "top", width: 0.1 },
      { route_type: "wire", x: 1, y: 0.4, layer: "top", width: 0.1 },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 12, minY: -3, maxY: 3 },
    connections: [],
    obstacles: [],
  }
  const original = [first, hidden, distant, fixed]
  const exposed = [createViaTrace("A", 2, 0.3, 0.1), hidden, distant, fixed]
  const prepared = createPreparedCircuitJsonConverter(srj)
  const baseline = prepared(original)
  const baselineCopy = structuredClone(baseline)
  const baselineDrc = getDrcErrors(structuredClone(baseline), {
    includeTraceContinuity: false,
    includeBoardEdge: false,
  })
  for (const routes of [original, exposed, exposed, original]) {
    const actual = prepared(routes)
    const expected = convertToCircuitJson(srj, routes)
    expect(actual).toEqual(expected)
    const actualDrc = getDrcErrors(actual, {
      includeTraceContinuity: false,
      includeBoardEdge: false,
    })
    expect(actualDrc).toEqual(
      getDrcErrors(expected, {
        includeTraceContinuity: false,
        includeBoardEdge: false,
      }),
    )
    const vias = actual.filter((element) => element.type === "pcb_via")
    expect(vias.map((via) => [via.pcb_via_id, via.pcb_trace_id])).toEqual(
      routes === exposed
        ? [
            ["via_0", "A"],
            ["via_1", "B"],
            ["via_2", "D"],
          ]
        : [
            ["via_0", "A"],
            ["via_1", "D"],
          ],
    )
    if (routes === exposed) {
      expect(vias[1]!.outer_diameter).toBe(0.9)
      expect(vias[1]!.hole_diameter).toBe(0.45)
      expect(actualDrc.errors.length).toBeGreaterThan(baselineDrc.errors.length)
    }
    expect(baseline).toEqual(baselineCopy)
  }
})
