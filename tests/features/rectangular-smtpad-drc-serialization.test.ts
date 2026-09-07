import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("serializes pad copper while retaining real DRC failures", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -2, maxX: 6, minY: -2, maxY: 2 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_left" },
          { x: 4, y: 0, layer: "top", pcb_port_id: "pcb_port_right" },
        ],
      },
    ],
    obstacles: [
      ...[0.5, 0, -0.5].map((y): Obstacle => ({
        type: "rect",
        center: { x: 0, y },
        width: 1,
        height: 0.6,
        layers: ["top"],
        connectedTo: ["signal", "pcb_port_left"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "left_pad",
          pcb_port_id: "pcb_port_left",
        },
      })),
      {
        type: "rect",
        center: { x: 4, y: 0 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["signal", "pcb_port_right"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "right_pad",
          pcb_port_id: "pcb_port_right",
        },
      },
    ],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "routed_signal",
    connection_name: "signal",
    connectsTo: ["pcb_port_left", "pcb_port_right"],
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.15, layer: "top" },
      { route_type: "wire", x: 4, y: 0, width: 0.15, layer: "top" },
    ],
  }
  const inputBefore = structuredClone(srj)
  const traceBefore = structuredClone(trace)
  const evaluate = (
    input: SimpleRouteJson,
    traces: SimplifiedPcbTrace[],
  ): ReturnType<typeof evaluateRelaxedDrc> =>
    evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: input,
      routedTraces: traces,
      drcOptions: { includeViaPadChecks: true },
    })
  const clean = evaluate(srj, [trace])
  expect(clean.errors).toHaveLength(0)
  expect(srj).toEqual(inputBefore)
  expect(trace).toEqual(traceBefore)

  const foreign: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "foreign_trace",
    connection_name: "foreign",
    route: [
      { route_type: "wire", x: -0.2, y: -0.2, width: 0.15, layer: "top" },
      { route_type: "wire", x: 0.2, y: -0.2, width: 0.15, layer: "top" },
    ],
  }
  expect(
    evaluate(srj, [trace, foreign]).errors.some(
      (error): boolean => error.message.includes("smtpad"),
    ),
  ).toBe(true)

  const gap = structuredClone(srj)
  gap.obstacles = gap.obstacles.filter(
    (obstacle): boolean => obstacle.center.x !== 0 || obstacle.center.y !== 0,
  )
  expect(
    evaluate(gap, [trace]).errors.some(
      (error): boolean => error.message.includes("missing a connection"),
    ),
  ).toBe(true)

  const disconnected = structuredClone(foreign)
  disconnected.route = [
    { route_type: "wire", x: 2, y: 1.5, width: 0.15, layer: "top" },
    { route_type: "wire", x: 3, y: 1.5, width: 0.15, layer: "top" },
  ]
  expect(
    evaluate(srj, [trace, disconnected]).errors.some(
      (error): boolean => error.message.includes("disconnected endpoint"),
    ),
  ).toBe(true)
})
