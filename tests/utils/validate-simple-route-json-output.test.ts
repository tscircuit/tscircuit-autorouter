import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import {
  getSimpleRouteJsonOutputValidationFailure,
  signedGapCircleToAabb,
  validateSimpleRouteJsonOutput,
} from "lib/utils/validateSimpleRouteJsonOutput"

const gpio5Pad = {
  type: "rect" as const,
  layers: ["top"],
  center: { x: -2.99999, y: 5.975102 },
  width: 0.6500114,
  height: 0.1500124,
  connectedTo: ["source_trace_33", "U_MCU.pin5"],
}

const gpio6Pad = {
  type: "rect" as const,
  layers: ["top"],
  center: { x: -2.99999, y: 5.62509 },
  width: 0.6500114,
  height: 0.1500124,
  connectedTo: ["source_trace_34", "U_MCU.pin6"],
}

const makeSrj = (
  traces: SimpleRouteJson["traces"],
  extra?: Partial<SimpleRouteJson>,
): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.15,
  minViaDiameter: 0.6,
  allowViaInPad: false,
  obstacles: [gpio5Pad, gpio6Pad],
  connections: [
    { name: "source_trace_33", pointsToConnect: [] },
    { name: "source_trace_34", pointsToConnect: [] },
  ],
  bounds: { minX: -5, maxX: 5, minY: 4, maxY: 8 },
  traces,
  ...extra,
})

test("signedGapCircleToAabb is negative when the circle overlaps the rect", () => {
  expect(
    signedGapCircleToAabb({
      cx: -2.8,
      cy: 5.8,
      radius: 0.3,
      center: gpio5Pad.center,
      width: gpio5Pad.width,
      height: gpio5Pad.height,
    }),
  ).toBeLessThan(0)
})

test("flags a post-processed via that overlaps a neighboring pad (#2058)", () => {
  const srj = makeSrj([
    {
      type: "pcb_trace",
      pcb_trace_id: "pcb_via_119_trace",
      connection_name: "source_trace_34",
      connectsTo: ["source_trace_34", "U_MCU.pin6"],
      route: [
        {
          route_type: "via",
          x: -2.8,
          y: 5.8,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.6,
        },
      ],
    },
  ])

  const violations = validateSimpleRouteJsonOutput(srj)
  expect(violations.length).toBeGreaterThan(0)
  expect(violations[0]).toMatchObject({
    type: "via_overlaps_unrelated_pad",
    connectionName: "source_trace_34",
  })
  expect(violations[0]!.pad.connectedTo).toContain("U_MCU.pin5")
  expect(violations.some((v) => v.pad.connectedTo.includes("U_MCU.pin6"))).toBe(
    false,
  )

  const message = getSimpleRouteJsonOutputValidationFailure(srj)
  expect(message).toContain("via_overlaps_unrelated_pad")
  expect(message).toContain("source_trace_34")
})

test("does not flag a via that stays clear of unrelated pads", () => {
  const srj = makeSrj([
    {
      type: "pcb_trace",
      pcb_trace_id: "far_via",
      connection_name: "source_trace_34",
      connectsTo: ["source_trace_34", "U_MCU.pin6"],
      route: [
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.6,
        },
      ],
    },
  ])

  expect(validateSimpleRouteJsonOutput(srj)).toEqual([])
  expect(getSimpleRouteJsonOutputValidationFailure(srj)).toBeNull()
})

test("flags via-in-pad on a connected pad when allowViaInPad is false", () => {
  const ownPad = {
    type: "rect" as const,
    layers: ["top"],
    center: { x: 10, y: 10 },
    width: 0.8,
    height: 0.8,
    connectedTo: ["source_trace_34", "U_MCU.pin6"],
  }
  const srj = makeSrj(
    [
      {
        type: "pcb_trace",
        pcb_trace_id: "via_in_pad",
        connection_name: "source_trace_34",
        connectsTo: ["source_trace_34", "U_MCU.pin6"],
        route: [
          {
            route_type: "via",
            x: ownPad.center.x,
            y: ownPad.center.y,
            from_layer: "top",
            to_layer: "bottom",
            via_diameter: 0.6,
          },
        ],
      },
    ],
    { allowViaInPad: false, obstacles: [ownPad] },
  )

  const violations = validateSimpleRouteJsonOutput(srj)
  expect(violations).toHaveLength(1)
  expect(violations[0]!.type).toBe("via_in_connected_pad")
})

test("allows via-in-pad when allowViaInPad is true", () => {
  const ownPad = {
    type: "rect" as const,
    layers: ["top"],
    center: { x: 10, y: 10 },
    width: 0.8,
    height: 0.8,
    connectedTo: ["source_trace_34", "U_MCU.pin6"],
  }
  const srj = makeSrj(
    [
      {
        type: "pcb_trace",
        pcb_trace_id: "via_in_pad",
        connection_name: "source_trace_34",
        connectsTo: ["source_trace_34", "U_MCU.pin6"],
        route: [
          {
            route_type: "via",
            x: ownPad.center.x,
            y: ownPad.center.y,
            from_layer: "top",
            to_layer: "bottom",
            via_diameter: 0.6,
          },
        ],
      },
    ],
    { allowViaInPad: true, obstacles: [ownPad] },
  )

  expect(validateSimpleRouteJsonOutput(srj)).toEqual([])
})
