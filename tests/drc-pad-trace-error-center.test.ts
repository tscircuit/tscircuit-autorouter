import { expect, test } from "bun:test"
import { checkPadTraceClearance } from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
  type GraphicsObject,
} from "graphics-debug"
import { getDrcErrors } from "lib/testing/getDrcErrors"

test("locates pad-trace clearance errors at the involved pad", () => {
  const circuitJson: AnyCircuitElement[] = [
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pad_a",
      shape: "rect",
      x: 1,
      y: 0.2,
      width: 0.2,
      height: 0.2,
      layer: "top",
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_b",
      route: [
        { route_type: "wire", x: -10, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 10, y: 0, width: 0.1, layer: "top" },
      ],
    },
  ]
  const [reportedError] = checkPadTraceClearance(circuitJson, {
    minClearance: 0.1,
  })
  const { errors, errorsWithCenters } = getDrcErrors(circuitJson, {
    traceClearance: 0.1,
    includeTraceContinuity: false,
  })
  const normalizedError = errors.find(
    (error) => error.type === "pcb_pad_trace_clearance_error",
  )

  expect(reportedError?.center).toEqual({ x: 0, y: 0 })
  expect(normalizedError).toMatchObject({
    type: "pcb_pad_trace_clearance_error",
    pcb_pad_id: "pad_a",
    pcb_trace_id: "trace_b",
    center: { x: 1, y: 0.2 },
  })
  expect(
    errorsWithCenters.find(
      (error) => error.type === "pcb_pad_trace_clearance_error",
    )?.center,
  ).toEqual({ x: 1, y: 0.2 })

  const getPanel = (
    marker: { x: number; y: number },
    markerColor: string,
  ): GraphicsObject => ({
    coordinateSystem: "cartesian",
    rects: [
      {
        center: { x: 1, y: 0.2 },
        width: 0.2,
        height: 0.2,
        fill: "rgba(148, 163, 184, 0.55)",
        stroke: "#475569",
        label: "pad_a",
      },
    ],
    lines: [
      {
        points: [
          { x: -1, y: 0 },
          { x: 2, y: 0 },
        ],
        strokeColor: "#2563eb",
        strokeWidth: 0.1,
        label: "trace_b",
      },
    ],
    circles: [
      {
        center: marker,
        radius: 0.08,
        fill: markerColor,
        stroke: "#111827",
      },
    ],
  })
  const svg = getSvgFromGraphicsObject(
    stackGraphicsHorizontally(
      [
        getPanel(reportedError!.center!, "rgba(147, 51, 234, 0.6)"),
        getPanel(
          errorsWithCenters.find(
            (error) => error.type === "pcb_pad_trace_clearance_error",
          )!.center!,
          "rgba(34, 197, 94, 0.6)",
        ),
      ],
      {
        titles: ["Before: generic trace center", "After: involved pad center"],
      },
    ),
    { backgroundColor: "white" },
  ).replace(/[ \t]+$/gm, "")

  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
