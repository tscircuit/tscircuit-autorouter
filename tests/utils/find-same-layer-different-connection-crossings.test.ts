import { describe, expect, test } from "bun:test"
import type { SimplifiedPcbTraces } from "lib/types"
import {
  findSameLayerDifferentConnectionCrossings,
  getSameLayerCrossingFailure,
} from "lib/utils/findSameLayerDifferentConnectionCrossings"

const wire = (
  x: number,
  y: number,
  layer = "top",
): SimplifiedPcbTraces[number]["route"][number] => ({
  route_type: "wire",
  x,
  y,
  width: 0.15,
  layer,
})

const trace = (
  pcb_trace_id: string,
  connection_name: string,
  points: Array<{ x: number; y: number; layer?: string }>,
): SimplifiedPcbTraces[number] => ({
  type: "pcb_trace",
  pcb_trace_id,
  connection_name,
  route: points.map((p) => wire(p.x, p.y, p.layer)),
})

describe("findSameLayerDifferentConnectionCrossings", () => {
  test("flags the nRF52810 crystal short at (-1.862, 5.518)", () => {
    const traces: SimplifiedPcbTraces = [
      trace(
        "source_trace_52__source_trace_55_0",
        "source_trace_52__source_trace_55",
        [
          { x: -3.5, y: 5.518 },
          { x: 0, y: 5.518 },
        ],
      ),
      trace(
        "source_trace_51__source_trace_53_0",
        "source_trace_51__source_trace_53",
        [
          { x: -1.862, y: 4 },
          { x: -1.862, y: 7 },
        ],
      ),
    ]

    const crossings = findSameLayerDifferentConnectionCrossings(traces)
    expect(crossings).toHaveLength(1)
    expect(crossings[0]!.layer).toBe("top")
    expect(crossings[0]!.x).toBeCloseTo(-1.862, 3)
    expect(crossings[0]!.y).toBeCloseTo(5.518, 3)
    expect(getSameLayerCrossingFailure(traces)).toContain(
      "source_trace_52__source_trace_55_0 x source_trace_51__source_trace_53_0",
    )
  })

  test("ignores same-connection traces even when segments cross", () => {
    const traces: SimplifiedPcbTraces = [
      trace("net_a_0", "GND", [
        { x: 0, y: 0 },
        { x: 2, y: 2 },
      ]),
      trace("net_a_1", "GND", [
        { x: 0, y: 2 },
        { x: 2, y: 0 },
      ]),
    ]
    expect(findSameLayerDifferentConnectionCrossings(traces)).toEqual([])
  })

  test("uses connMap to skip electrically connected traces with different names", () => {
    const traces: SimplifiedPcbTraces = [
      trace("osc1_0", "source_trace_51", [
        { x: 0, y: 1 },
        { x: 2, y: 1 },
      ]),
      trace("osc1_alias_0", "XL1", [
        { x: 1, y: 0 },
        { x: 1, y: 2 },
      ]),
    ]
    const connMap = {
      areIdsConnected: (a: string, b: string) =>
        a !== b &&
        ["source_trace_51", "XL1", "osc1_0", "osc1_alias_0"].includes(a) &&
        ["source_trace_51", "XL1", "osc1_0", "osc1_alias_0"].includes(b),
    }
    expect(findSameLayerDifferentConnectionCrossings(traces, connMap)).toEqual(
      [],
    )
    expect(findSameLayerDifferentConnectionCrossings(traces)).toHaveLength(1)
  })

  test("ignores opposite-layer traces that would otherwise cross in 2d", () => {
    const traces: SimplifiedPcbTraces = [
      trace("top_0", "net_a", [
        { x: 0, y: 1 },
        { x: 2, y: 1, layer: "top" },
      ]),
      trace("bottom_0", "net_b", [
        { x: 1, y: 0, layer: "bottom" },
        { x: 1, y: 2, layer: "bottom" },
      ]),
    ]
    expect(findSameLayerDifferentConnectionCrossings(traces)).toEqual([])
  })

  test("ignores traces that only share an endpoint", () => {
    const traces: SimplifiedPcbTraces = [
      trace("a_0", "net_a", [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
      trace("b_0", "net_b", [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]),
    ]
    expect(findSameLayerDifferentConnectionCrossings(traces)).toEqual([])
  })

  test("flags a T-junction onto a different net", () => {
    const traces: SimplifiedPcbTraces = [
      trace("a_0", "net_a", [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ]),
      trace("b_0", "net_b", [
        { x: 1, y: 0 },
        { x: 1, y: 2 },
      ]),
    ]
    const crossings = findSameLayerDifferentConnectionCrossings(traces)
    expect(crossings).toHaveLength(1)
    expect(crossings[0]!.x).toBeCloseTo(1)
    expect(crossings[0]!.y).toBeCloseTo(0)
  })

  test("returns null failure when traces are clean", () => {
    const traces: SimplifiedPcbTraces = [
      trace("a_0", "net_a", [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
      trace("b_0", "net_b", [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]),
    ]
    expect(getSameLayerCrossingFailure(traces)).toBeNull()
  })
})
