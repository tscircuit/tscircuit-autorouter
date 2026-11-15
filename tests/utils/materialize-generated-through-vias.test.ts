import { expect, test } from "bun:test"
import type { SimplifiedPcbTraces } from "lib/types"
import {
  materializeGeneratedThroughVias,
  shouldUseThroughVias,
} from "lib/utils/materializeGeneratedThroughVias"

test("omitted or true allowBlindAndBuriedVias keeps generated partial spans", () => {
  expect(shouldUseThroughVias(undefined)).toBe(false)
  expect(shouldUseThroughVias(true)).toBe(false)
  expect(shouldUseThroughVias(false)).toBe(true)
  expect(() => shouldUseThroughVias("yes" as unknown as boolean)).toThrow(
    "allowBlindAndBuriedVias must be a boolean when provided",
  )
})

test("false rewrites generated vias to the full board stack and preserves authored spans", () => {
  const authored: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "authored",
      connection_name: "SIG",
      route: [
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
        },
      ],
    },
  ]
  const output: SimplifiedPcbTraces = [
    ...authored,
    {
      type: "pcb_trace",
      pcb_trace_id: "generated",
      connection_name: "SIG",
      route: [
        {
          route_type: "via",
          x: 2,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
        },
      ],
    },
  ]

  const materialized = materializeGeneratedThroughVias({
    inputTraces: authored,
    outputTraces: output,
    layerCount: 4,
    allowBlindAndBuriedVias: false,
  })

  expect(materialized[0]!.route[0]).toMatchObject({
    from_layer: "top",
    to_layer: "inner1",
  })
  expect(materialized[1]!.route[0]).toMatchObject({
    from_layer: "top",
    to_layer: "bottom",
  })
})
