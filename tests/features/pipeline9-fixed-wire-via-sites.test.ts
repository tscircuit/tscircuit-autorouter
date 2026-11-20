import { expect, test } from "bun:test"
import { splitNodesWithoutThroughViaSite } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/splitNodesWithoutThroughViaSite"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("a through-via cell keeps its layers when a corner clears the wire or the net can reuse it", () => {
  const input: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 2, minY: -1, maxY: 1 },
    layerCount: 4,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    obstacles: [],
    connections: [{ name: "strobe", pointsToConnect: [] }],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "dq-wire",
        connection_name: "dq",
        isFixed: true,
        route: [
          { route_type: "wire", x: -1, y: 0, layer: "inner1", width: 0.1 },
          { route_type: "wire", x: 1, y: 0, layer: "inner1", width: 0.1 },
        ],
      },
    ],
  }
  const blocked: CapacityMeshNode = {
    capacityMeshNodeId: "blocked",
    center: { x: 0, y: 0 },
    width: 0.2,
    height: 0.45,
    availableZ: [0, 3],
    layer: "z0,3",
  }
  const clearanceOnly = {
    ...blocked,
    capacityMeshNodeId: "clearance-only",
    height: 0.55,
  }
  // At y = 0.3 the via pad and wire meet the declared clearance exactly.
  const tangent = { ...blocked, capacityMeshNodeId: "tangent", height: 0.6 }
  const nodes = [blocked, clearanceOnly, tangent]
  const plan = (
    srj: SimpleRouteJson,
    layerChangeNodeIds = new Set(["blocked"]),
  ): CapacityMeshNode[] =>
    splitNodesWithoutThroughViaSite({
      nodes,
      layerChangeNodeIds,
      srj,
      viaDiameter: 0.4,
      connMap: getConnectivityMapFromSimpleRouteJson(srj),
    })

  expect(plan(input, new Set(["tangent"]))).toBe(nodes)
  const [top, bottom, near, clear] = plan(input, new Set(["clearance-only"]))
  expect([top.availableZ, bottom.availableZ]).toEqual([[0], [3]])
  expect(near).toBe(clearanceOnly)
  expect(clear).toBe(tangent)
  const stricter = plan(input)
  expect(stricter.map((node) => node.availableZ)).toEqual([
    [0],
    [3],
    [0],
    [3],
    [0, 3],
  ])
  expect(stricter[4]).toBe(tangent)
  expect(plan({ ...input, allowBlindAndBuriedVias: true })).toEqual(nodes)
  expect(
    plan({
      ...input,
      connections: [
        {
          name: "dq-continuation",
          __rootConnectionNames: ["dq"],
          pointsToConnect: [],
        },
      ],
    }),
  ).toEqual(nodes)
})
