import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("via-pad reference clearance follows declared rules and physical through or blind copper layers", (): void => {
  for (const entry of [
    {
      gap: 0.08,
      declared: undefined,
      override: undefined,
      blind: false,
      errors: 1,
    },
    {
      gap: 0.12,
      declared: undefined,
      override: undefined,
      blind: false,
      errors: 0,
    },
    { gap: 0.15, declared: 0.2, override: undefined, blind: false, errors: 1 },
    { gap: 0.15, declared: 0.2, override: 0.1, blind: false, errors: 0 },
    { gap: 0.08, declared: 0.05, override: undefined, blind: false, errors: 0 },
    {
      gap: 0.15,
      declared: undefined,
      boardRule: 0.2,
      override: undefined,
      blind: false,
      errors: 1,
    },
    {
      gap: -0.05,
      declared: undefined,
      override: undefined,
      blind: true,
      errors: 0,
    },
  ]) {
    const x = 0.5 + 0.15 + entry.gap
    const srj: SimpleRouteJson = {
      layerCount: 8,
      minTraceWidth: 0.1,
      minViaPadDiameter: 0.3,
      minViaHoleDiameter: 0.15,
      defaultObstacleMargin: 0.15,
      minViaEdgeToPadEdgeClearance: entry.declared,
      minPadEdgeToPadEdgeClearance: entry.boardRule,
      allowBlindAndBuriedVias: entry.blind,
      bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
      connections: [{ name: "signal", pointsToConnect: [] }],
      obstacles: [
        {
          type: "rect",
          center: { x: 0, y: 0 },
          width: 1,
          height: 1,
          layers: ["top"],
          connectedTo: ["pcb_smtpad_foreign", "pcb_port_foreign"],
          circuitJsonMetadata: {
            pcb_smtpad_id: "pcb_smtpad_foreign",
            pcb_port_id: "pcb_port_foreign",
          },
        },
      ],
    }
    const trace: SimplifiedPcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: "signal_trace",
      connection_name: "signal",
      route: [
        { route_type: "wire", x: x - 3, y: 0, layer: "inner1", width: 0.1 },
        {
          route_type: "via",
          x,
          y: 0,
          from_layer: "inner1",
          to_layer: "inner2",
        },
        { route_type: "wire", x: x + 3, y: 0, layer: "inner2", width: 0.1 },
      ],
    }
    const result = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: [trace],
      drcOptions: {
        includeTraceContinuity: false,
        ...(entry.override === undefined
          ? {}
          : { viaPadClearance: entry.override }),
      },
    })
    const errors = result.errors.filter(
      (error) => error.type === "pcb_pad_pad_clearance_error",
    )
    expect(errors).toHaveLength(entry.errors)
    if (entry.errors) {
      expect(errors[0]!.minimum_clearance).toBe(
        entry.override ?? entry.declared ?? entry.boardRule ?? 0.1,
      )
      expect(errors[0]!.actual_clearance).toBeCloseTo(entry.gap, 8)
    }
  }
})
