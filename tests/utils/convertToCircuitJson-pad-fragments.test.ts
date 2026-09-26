import { expect, test } from "bun:test"
import { checkTracesAreContiguous } from "@tscircuit/checks"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("DRC conversion preserves every pad fragment and net-owned plated terminal", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    connections: [
      {
        name: "net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "start" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "end" },
        ],
      },
    ],
    obstacles: [
      ...[-1, 0, 1, 0].map((y) => ({
        type: "rect" as const,
        center: { x: 0, y },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["net", "start"],
        circuitJsonMetadata: { pcb_smtpad_id: "pad", pcb_port_id: "start" },
      })),
      {
        type: "rect",
        center: { x: 2, y: 0 },
        width: 1,
        height: 1,
        layers: ["top", "bottom"],
        connectedTo: ["net"],
      },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace",
      connection_name: "net",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "bottom_terminal",
      connection_name: "net",
      route: [
        {
          route_type: "wire",
          x: 2,
          y: 0,
          width: 0.1,
          layer: "bottom",
          start_pcb_port_id: "end",
        },
        { route_type: "wire", x: 2.1, y: 0, width: 0.1, layer: "bottom" },
      ],
    },
  ]
  const circuit = convertToCircuitJson(srj, traces)
  const pads = circuit.filter((e) => e.type === "pcb_smtpad")
  expect(pads.map((pad) => ("y" in pad ? pad.y : undefined))).toEqual([
    -1, 0, 1,
  ])
  expect(new Set(pads.map((pad) => pad.pcb_smtpad_id)).size).toBe(3)
  expect(pads.every((pad) => pad.pcb_port_id === "start")).toBe(true)
  expect(circuit.find((e) => e.type === "pcb_plated_hole")).toMatchObject({
    pcb_port_id: "end",
    layers: ["top", "bottom"],
  })
  expect(checkTracesAreContiguous(circuit)).toEqual([])

  const aliasedSrj = structuredClone(srj)
  for (const obstacle of aliasedSrj.obstacles) {
    if (obstacle.circuitJsonMetadata) {
      obstacle.circuitJsonMetadata.pcb_port_id = "imported_start_alias"
    }
  }
  const aliasedCircuit = convertToCircuitJson(aliasedSrj, traces)
  expect(
    aliasedCircuit
      .filter((element) => element.type === "pcb_smtpad")
      .every((pad) => pad.pcb_port_id === "start"),
  ).toBe(true)
  expect(checkTracesAreContiguous(aliasedCircuit)).toEqual([])

  const assignablePad = srj.obstacles.at(-1)!
  assignablePad.connectedTo = ["assignable_pool"]
  assignablePad.netIsAssignable = true
  expect(
    convertToCircuitJson(srj, traces).find(
      (element) => element.type === "pcb_plated_hole",
    ),
  ).toMatchObject({ pcb_port_id: "end", layers: ["top", "bottom"] })
  assignablePad.netIsAssignable = false
  expect(
    convertToCircuitJson(srj, traces).some(
      (element) => element.type === "pcb_plated_hole",
    ),
  ).toBe(false)
})
