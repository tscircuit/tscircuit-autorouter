import { expect, test } from "bun:test"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"

const createSrj = (minViaDiameter?: number): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.1,
  ...(minViaDiameter !== undefined ? { minViaDiameter } : {}),
  obstacles: [],
  connections: [
    {
      name: "conn_1",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pointId: "p1" },
        { x: 1, y: 1, layer: "bottom", pointId: "p2" },
      ],
    },
  ],
  bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
})

const createSimplifiedTraces = (viaDiameter?: number): SimplifiedPcbTrace[] => [
  {
    type: "pcb_trace",
    pcb_trace_id: "conn_1_0",
    connection_name: "conn_1",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x: 0.5,
        y: 0.5,
        from_layer: "top",
        to_layer: "bottom",
        ...(viaDiameter !== undefined ? { via_diameter: viaDiameter } : {}),
      },
      { route_type: "wire", x: 1, y: 1, width: 0.1, layer: "bottom" },
    ],
  },
]

test("uses actual via diameter from simplified route when available", () => {
  const circuitJson = convertToCircuitJson(
    createSrj(0.24),
    createSimplifiedTraces(0.33),
  )
  const vias = circuitJson.filter((e) => e.type === "pcb_via")
  expect(vias).toHaveLength(1)
  expect(vias[0].outer_diameter).toBe(0.33)
})

test("falls back to srj.minViaDiameter when actual diameter is missing", () => {
  const circuitJson = convertToCircuitJson(
    createSrj(0.24),
    createSimplifiedTraces(),
  )
  const vias = circuitJson.filter((e) => e.type === "pcb_via")
  expect(vias).toHaveLength(1)
  expect(vias[0].outer_diameter).toBe(0.24)
})

test("falls back to 0.3 when neither actual nor srj min via diameter is available", () => {
  const circuitJson = convertToCircuitJson(
    createSrj(),
    createSimplifiedTraces(),
  )
  const vias = circuitJson.filter((e) => e.type === "pcb_via")
  expect(vias).toHaveLength(1)
  expect(vias[0].outer_diameter).toBe(0.3)
})
