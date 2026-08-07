import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("reproduces relaxed DRC rebuilding rotated pads from routing fragments", () => {
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 5, maxY: 1 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.25,
        height: 1.025,
        ccwRotationDegrees: 45,
        connectedTo: ["pcb_smtpad_start", "pcb_port_start", "trace"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 4, y: 0 },
        width: 0.25,
        height: 1.025,
        ccwRotationDegrees: 45,
        connectedTo: ["pcb_smtpad_end", "pcb_port_end", "trace"],
      },
    ],
    connections: [
      {
        name: "trace",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_start" },
          { x: 4, y: 0, layer: "top", pcb_port_id: "pcb_port_end" },
        ],
      },
    ],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...inputSrj,
    obstacles: inputSrj.obstacles.map((obstacle) => ({
      ...obstacle,
      center: {
        x: obstacle.center.x + 0.24,
        y: obstacle.center.y + 0.24,
      },
      width: 0.25,
      height: 0.25,
      ccwRotationDegrees: undefined,
    })),
  }
  const routedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "pcb_trace_trace",
    connection_name: "trace",
    route: [
      {
        route_type: "wire",
        x: 0,
        y: 0,
        width: 0.1,
        layer: "top",
        start_pcb_port_id: "pcb_port_start",
      },
      {
        route_type: "wire",
        x: 4,
        y: 0,
        width: 0.1,
        layer: "top",
        end_pcb_port_id: "pcb_port_end",
      },
    ],
  }

  const { circuitJson, errors } = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    routedTraces: [routedTrace],
  })
  const startPad = circuitJson.find(
    (element) =>
      element.type === "pcb_smtpad" &&
      element.pcb_smtpad_id === "pcb_smtpad_start",
  )
  const missingConnectionErrors = errors.filter(
    (error) =>
      "message" in error && error.message.includes("missing a connection"),
  )

  expect(startPad).toMatchObject({
    shape: "rect",
    x: 0.24,
    y: 0.24,
    width: 0.25,
    height: 0.25,
  })
  expect(missingConnectionErrors.length).toBeGreaterThan(0)
  expect(
    convertCircuitJsonToPcbSvg([...circuitJson, ...errors], {
      backgroundColor: "white",
      shouldDrawErrors: true,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})
