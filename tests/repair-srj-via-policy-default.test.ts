import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  type SimpleRouteJson as RepairSimpleRouteJson,
  type SimplifiedPcbTraces as RepairSimplifiedPcbTraces,
} from "high-density-repair03/lib"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { normalizeRepairSrjViaPolicy } from "lib/utils/normalize-repair-srj-via-policy"

test("repair SRJ normalization defaults omitted via policy to through vias", () => {
  const baseSrj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "via_signal",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "inner1" },
        ],
      },
      {
        name: "bottom_signal",
        pointsToConnect: [
          { x: 0, y: -1, layer: "bottom" },
          { x: 0, y: 1, layer: "bottom" },
        ],
      },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "via_trace",
      connection_name: "via_signal",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
          via_diameter: 0.3,
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner1" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "inner1" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "bottom_trace",
      connection_name: "bottom_signal",
      route: [
        { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "bottom" },
      ],
    },
  ]
  const defaultSrj = normalizeRepairSrjViaPolicy(baseSrj)
  const throughSrj = normalizeRepairSrjViaPolicy({
    ...baseSrj,
    allowBlindAndBuriedVias: false,
  })
  const blindSrj = normalizeRepairSrjViaPolicy({
    ...baseSrj,
    allowBlindAndBuriedVias: true,
  })
  const defaultResult = new AutoroutingDrcEngine(
    defaultSrj as RepairSimpleRouteJson,
  ).evaluate(traces as RepairSimplifiedPcbTraces)
  const throughResult = new AutoroutingDrcEngine(
    throughSrj as RepairSimpleRouteJson,
  ).evaluate(traces as RepairSimplifiedPcbTraces)
  const blindResult = new AutoroutingDrcEngine(
    blindSrj as RepairSimpleRouteJson,
  ).evaluate(traces as RepairSimplifiedPcbTraces)

  expect(baseSrj.allowBlindAndBuriedVias).toBeUndefined()
  expect(defaultSrj.allowBlindAndBuriedVias).toBe(false)
  expect(defaultResult.errors.map((error) => error.error_type)).toEqual([
    "pcb_trace_error",
  ])
  expect(throughResult.errors).toEqual(defaultResult.errors)
  expect(blindResult.errors).toHaveLength(0)
})
