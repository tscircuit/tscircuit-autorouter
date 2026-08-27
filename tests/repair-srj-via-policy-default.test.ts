import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  type SimpleRouteJson as RepairSimpleRouteJson,
  type SimplifiedPcbTraces as RepairSimplifiedPcbTraces,
} from "high-density-repair03/lib"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { normalizeRepairSrjViaPolicy } from "lib/utils/normalize-repair-srj-via-policy"

test("repair via policy preserves legacy SRJs and defaults role-aware SRJs to through", () => {
  const baseSrj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
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
  const legacySrj = normalizeRepairSrjViaPolicy(baseSrj)
  const roleAwareSrj = normalizeRepairSrjViaPolicy({
    ...baseSrj,
    obstacles: [
      {
        type: "rect" as const,
        obstacleId: "board_keepout",
        obstacleRole: "keepout" as const,
        center: { x: 1.5, y: 1.5 },
        width: 0.1,
        height: 0.1,
        layers: ["top" as const],
        connectedTo: [],
      },
    ],
  })
  const explicitThroughSrj = normalizeRepairSrjViaPolicy({
    ...baseSrj,
    allowBlindAndBuriedVias: false,
  })
  const explicitBlindSrj = normalizeRepairSrjViaPolicy({
    ...baseSrj,
    allowBlindAndBuriedVias: true,
  })
  const evaluate = (srj: SimpleRouteJson) =>
    new AutoroutingDrcEngine(srj as RepairSimpleRouteJson).evaluate(
      traces as RepairSimplifiedPcbTraces,
    ).errors

  expect(legacySrj).toBe(baseSrj)
  expect(legacySrj.allowBlindAndBuriedVias).toBeUndefined()
  expect(evaluate(legacySrj)).toHaveLength(0)
  expect(roleAwareSrj.allowBlindAndBuriedVias).toBe(false)
  expect(evaluate(roleAwareSrj).map((error) => error.error_type)).toEqual([
    "pcb_trace_error",
  ])
  expect(evaluate(explicitThroughSrj)).toEqual(evaluate(roleAwareSrj))
  expect(evaluate(explicitBlindSrj)).toHaveLength(0)
})
