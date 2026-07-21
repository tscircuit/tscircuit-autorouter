import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { normalizePhysicalConnectivity } from "lib/utils/normalizePhysicalConnectivity"

test("projects routed connectivity through hidden trace endpoints", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 4, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "shared_net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "A" },
          { x: 3, y: 0, layer: "top", pointId: "B" },
          { x: 4, y: 0, layer: "top", pointId: "unrouted" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "trace_1",
        connection_name: "child_trace_1",
        connectsTo: ["A", "hidden_1"],
        route: [],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "trace_2",
        connection_name: "child_trace_2",
        connectsTo: ["hidden_1", "hidden_2"],
        route: [],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "trace_3",
        connection_name: "child_trace_3",
        connectsTo: ["hidden_2", "B"],
        route: [],
      },
    ],
  }

  const result = normalizePhysicalConnectivity(srj)

  expect(result.connections[0]!.externallyConnectedPointIds).toEqual([
    ["A", "B"],
  ])
  expect(result.traces?.[0]!.connectsTo).toEqual(["A", "hidden_1", "B"])
  expect(result.traces?.[1]!.connectsTo).toEqual(["hidden_1", "hidden_2"])
  expect(srj.connections[0]!.externallyConnectedPointIds).toBeUndefined()
  expect(srj.traces?.[0]!.connectsTo).toEqual(["A", "hidden_1"])
})
