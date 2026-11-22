import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { getDrcErrors } from "lib/testing/getDrcErrors"

const createSameNetViaPadCircuitJson = (): AnyCircuitElement[] => [
  {
    type: "pcb_board",
    pcb_board_id: "board_0",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    thickness: 1.4,
    num_layers: 2,
    material: "fr4",
  },
  {
    type: "pcb_port",
    pcb_port_id: "port_a",
    source_port_id: "source_port_a",
    x: 0,
    y: 0,
    layers: ["top"],
  },
  {
    type: "pcb_smtpad",
    pcb_smtpad_id: "pad_a",
    pcb_port_id: "port_a",
    x: 0,
    y: 0,
    width: 0.5,
    height: 0.5,
    layer: "top",
    shape: "rect",
  },
  {
    type: "pcb_trace",
    pcb_trace_id: "trace_a",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  },
  {
    type: "pcb_via",
    pcb_via_id: "via_a",
    x: 0.6,
    y: 0,
    outer_diameter: 0.6,
    hole_diameter: 0.3,
    layers: ["top", "bottom"],
    pcb_trace_id: "trace_a",
  },
]

test.failing("getDrcErrors allows a same-net via next to the pad its trace ends on", (): void => {
  const { errors } = getDrcErrors(createSameNetViaPadCircuitJson(), {
    viaToPadClearance: 0.2,
    includeTraceContinuity: false,
  })
  const sameNetViaPadErrors = errors.filter(
    (error) =>
      error.type === "pcb_pad_pad_clearance_error" &&
      error.pcb_pad_ids.includes("via_a") &&
      error.pcb_pad_ids.includes("pad_a"),
  )
  const svg = getSvgFromGraphicsObject(
    {
      rects: [
        { center: { x: 0, y: 0 }, width: 0.5, height: 0.5, fill: "#f87171" },
      ],
      lines: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
          strokeColor: "#2563eb",
          strokeWidth: 0.1,
        },
      ],
      circles: [{ center: { x: 0.6, y: 0 }, radius: 0.3, fill: "#16a34a" }],
      texts: [
        {
          x: 0,
          y: 0.8,
          text: `Same-net via to pad errors: ${sameNetViaPadErrors.length}`,
          fontSize: 0.12,
        },
      ],
    },
    { backgroundColor: "white" },
  )
  expect(svg).toMatchSvgSnapshot(import.meta.path)
  expect(sameNetViaPadErrors).toHaveLength(0)
})
