import { expect, test } from "bun:test"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import {
  convertToCircuitJson,
  createPreparedCircuitJsonConverter,
  createPreparedImmutableCircuitJsonConverter,
} from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("prepared circuit JSON preserves first-fragment seam connectivity and detached outputs", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    connections: [
      {
        name: "A",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pcb_port_id: "A-left" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "A-right" },
        ],
      },
      {
        name: "C",
        pointsToConnect: [
          { x: 0, y: 1, layer: "top", pcb_port_id: "C-pad-port" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 1 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["C", "C-pad-port"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "opaque-pad-via_0",
          pcb_port_id: "C-pad-port",
        },
      },
    ],
  }
  const first: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "A_first",
    connection_name: "A",
    connectsTo: ["A-left", "A-right"],
    route: [
      { route_type: "wire", x: -2, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
    ],
  }
  const second: SimplifiedPcbTrace = {
    ...first,
    pcb_trace_id: "A_second",
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.1 },
    ],
  }
  const original = [first, second]
  const moved = [
    {
      ...first,
      route: [first.route[0]!, { ...first.route[1]!, y: 1 }],
    },
    {
      ...second,
      route: [{ ...second.route[0]!, y: 1 }, second.route[1]!],
    },
  ]
  const options = { originalSrj: srj, includeOriginalConnections: true }
  const prepared = createPreparedCircuitJsonConverter(srj, options)
  const immutable = createPreparedImmutableCircuitJsonConverter(srj, options)
  for (const routes of [original, original, moved, moved, original]) {
    const actual = prepared(routes)
    const expected = convertToCircuitJson(srj, routes, options)
    expect(actual).toEqual(expected)
    expect(immutable(routes)).toEqual(expected)
    const source = actual.find(
      (element) =>
        element.type === "source_trace" && element.source_trace_id === "A",
    )
    expect(source?.type).toBe("source_trace")
    if (source?.type !== "source_trace") {
      throw new Error("Expected source trace A in prepared conversion")
    }
    expect(source.connected_source_net_ids?.includes("C")).toBe(
      routes === moved,
    )
    expect(
      getDrcErrors(actual, {
        includeTraceContinuity: false,
        includeBoardEdge: false,
      }),
    ).toEqual(
      getDrcErrors(expected, {
        includeTraceContinuity: false,
        includeBoardEdge: false,
      }),
    )
    // Neither official endpoint inference nor downstream array mutation may
    // leak into a later snapshot that reuses the same immutable input routes.
    source.connected_source_port_ids.push("mutated-output-only")
    const trace = actual.find((element) => element.type === "pcb_trace")
    if (trace?.type === "pcb_trace") trace.route.length = 0
    const port = actual.find((element) => element.type === "pcb_port")
    if (port?.type === "pcb_port") port.layers.push("bottom")
    const pad = actual.find((element) => element.type === "pcb_smtpad")
    if (pad?.type === "pcb_smtpad" && pad.shape === "rect") pad.x = 100
    expect(prepared(routes)).toEqual(convertToCircuitJson(srj, routes, options))
  }
})
