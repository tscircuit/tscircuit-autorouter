import { expect, test } from "bun:test"
import {
  getPcb3dExplodedLayerZ,
  getPcb3dRenderSummary,
} from "lib/testing/Pcb3dViewer"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("counts every SRJ geometry rendered by the 3D viewer", () => {
  const srj: SimpleRouteJson = {
    bounds: { maxX: 10, maxY: 8, minX: -10, minY: -8 },
    connections: [],
    layerCount: 4,
    minTraceWidth: 0.2,
    obstacles: [
      {
        center: { x: -2, y: 2 },
        componentId: "R1",
        connectedTo: ["pcb_smtpad_1"],
        height: 1,
        layers: ["top"],
        type: "rect",
        width: 1,
      },
      {
        center: { x: 2, y: 2 },
        componentId: "R1",
        connectedTo: ["pcb_smtpad_2"],
        height: 1,
        layers: ["top"],
        type: "rect",
        width: 1,
      },
      {
        center: { x: 0, y: -2 },
        connectedTo: ["pcb_plated_hole_1"],
        height: 1.4,
        layers: ["top", "inner1", "inner2", "bottom"],
        type: "rect",
        width: 1.4,
      },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    {
      connection_name: "net-1",
      pcb_trace_id: "trace-1",
      route: [
        { layer: "top", route_type: "wire", width: 0.25, x: -4, y: 0 },
        { layer: "top", route_type: "wire", width: 0.25, x: -1, y: 0 },
        {
          from_layer: "top",
          route_type: "via",
          to_layer: "bottom",
          via_diameter: 0.7,
          via_hole_diameter: 0.3,
          x: -1,
          y: 0,
        },
        { layer: "bottom", route_type: "wire", width: 0.25, x: 4, y: 0 },
        {
          end: { x: 3, y: 4 },
          footprint: "0603",
          layer: "top",
          route_type: "jumper",
          start: { x: -3, y: 4 },
        },
        {
          end: { x: 3, y: -4 },
          from_layer: "top",
          route_type: "through_obstacle",
          start: { x: -3, y: -4 },
          to_layer: "bottom",
          width: 0.25,
        },
      ],
      type: "pcb_trace",
    },
  ]

  const authoredGeometry = getPcb3dRenderSummary(srj, traces)
  expect(authoredGeometry).toEqual({
    boards: 1,
    holes: 1,
    inferredBodies: 0,
    jumpers: 1,
    pads: 6,
    traceSegments: 3,
    vias: 1,
  })
  expect(
    getPcb3dRenderSummary(srj, traces, {
      includeInferredBodies: true,
    }),
  ).toEqual({ ...authoredGeometry, inferredBodies: 1 })
  expect(getPcb3dExplodedLayerZ("top", 4, 2)).toBeCloseTo(3.8025)
  expect(getPcb3dExplodedLayerZ("bottom", 4, 2)).toBeCloseTo(-3.8025)
})
