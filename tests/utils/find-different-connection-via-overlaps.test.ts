import { describe, expect, test } from "bun:test"
import type { SimplifiedPcbTraces } from "lib/types"
import {
  findDifferentConnectionViaOverlaps,
  getDifferentConnectionViaOverlapFailure,
  layersOccupiedByVia,
} from "lib/utils/findDifferentConnectionViaOverlaps"

const viaPoint = (
  x: number,
  y: number,
  from_layer: string,
  to_layer: string,
  via_diameter = 0.6,
): SimplifiedPcbTraces[number]["route"][number] => ({
  route_type: "via",
  x,
  y,
  from_layer,
  to_layer,
  via_diameter,
})

const viaTrace = (
  pcb_trace_id: string,
  connection_name: string,
  x: number,
  y: number,
  from_layer: string,
  to_layer: string,
): SimplifiedPcbTraces[number] => ({
  type: "pcb_trace",
  pcb_trace_id,
  connection_name,
  route: [viaPoint(x, y, from_layer, to_layer)],
})

describe("findDifferentConnectionViaOverlaps", () => {
  test("flags the GPIO35/PSRAM via pair from #2147", () => {
    const traces: SimplifiedPcbTraces = [
      viaTrace(
        "source_trace_155__source_trace_156_mst1_0",
        "source_trace_156",
        6.539759,
        4.785715,
        "top",
        "inner2",
      ),
      viaTrace(
        "source_trace_126__source_trace_127__source_trace_128__source_trace_130__source_trace_132_mst0_0",
        "source_trace_130",
        6.190585,
        4.298298,
        "inner1",
        "top",
      ),
    ]

    expect(layersOccupiedByVia("top", "inner2", 4)).toEqual([
      "top",
      "inner1",
      "inner2",
    ])

    const overlaps = findDifferentConnectionViaOverlaps(traces, {
      layerCount: 4,
      defaultViaDiameter: 0.6,
      viaClearance: 0.1,
    })
    expect(overlaps.length).toBeGreaterThan(0)
    expect(overlaps[0]!.distance).toBeLessThan(0.7)
    expect(overlaps[0]!.minCenterDistance).toBeCloseTo(0.7)
    expect(
      getDifferentConnectionViaOverlapFailure(traces, {
        layerCount: 4,
        defaultViaDiameter: 0.6,
      }),
    ).toContain("Different-connection via pads overlap")
  })

  test("ignores vias that only meet the required center spacing", () => {
    const traces: SimplifiedPcbTraces = [
      viaTrace("a_0", "net_a", 0, 0, "top", "bottom"),
      viaTrace("b_0", "net_b", 0.8, 0, "top", "bottom"),
    ]
    expect(
      findDifferentConnectionViaOverlaps(traces, {
        layerCount: 2,
        defaultViaDiameter: 0.6,
        viaClearance: 0.1,
      }),
    ).toEqual([])
  })

  test("ignores opposite-layer vias that do not share copper", () => {
    const traces: SimplifiedPcbTraces = [
      viaTrace("a_0", "net_a", 0, 0, "top", "inner1"),
      viaTrace("b_0", "net_b", 0.1, 0, "inner2", "bottom"),
    ]
    expect(
      findDifferentConnectionViaOverlaps(traces, {
        layerCount: 4,
        defaultViaDiameter: 0.6,
      }),
    ).toEqual([])
  })

  test("ignores same-connection vias even when pads overlap", () => {
    const traces: SimplifiedPcbTraces = [
      viaTrace("gnd_0", "GND", 0, 0, "top", "bottom"),
      viaTrace("gnd_1", "GND", 0.2, 0, "top", "bottom"),
    ]
    expect(
      findDifferentConnectionViaOverlaps(traces, {
        layerCount: 2,
        defaultViaDiameter: 0.6,
      }),
    ).toEqual([])
  })
})
