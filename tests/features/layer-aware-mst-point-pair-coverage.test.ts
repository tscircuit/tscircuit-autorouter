import { expect, test } from "bun:test"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import { getLayerAwareMstPointKey } from "lib/solvers/NetToPointPairsSolver/getLayerAwareMstPointKey"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import type { SimpleRouteJson } from "lib/types"

test("active point-pair solver covers every layer requirement and retains exact original endpoint declarations", () => {
  const input: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -1, minY: -1, maxX: 3, maxY: 1 }, obstacles: [], connections: [{ name: "net", pointsToConnect: [
    { x: 0, y: 0, layer: "top", pointId: "top", pcb_port_id: "top" },
    { x: 0, y: 0, layer: "bottom", pointId: "bottom", pcb_port_id: "bottom" },
    { x: 2, y: 0, layer: "top", pointId: "other", pcb_port_id: "other" },
  ] }] }
  const before = JSON.stringify(input)
  const legacy = new NetToPointPairsSolver2_OffBoardConnection(input, {}, getInitiallyConnectedMapFromSimpleRouteJson(input))
  legacy.solve()
  const candidate = new NetToPointPairsSolver2_OffBoardConnection(input, {}, getInitiallyConnectedMapFromSimpleRouteJson(input), { pointKey: getLayerAwareMstPointKey })
  candidate.solve()
  expect(legacy.getNewSimpleRouteJson().connections.length).toBe(1)
  expect(Object.hasOwn(legacy, "layerAwareMstStats")).toBe(false)
  const pairs = candidate.getNewSimpleRouteJson().connections
  expect(pairs.length).toBe(2)
  expect(new Set(pairs.flatMap((pair) => pair.pointsToConnect.map((point) => point.pointId)))).toEqual(new Set(["top", "bottom", "other"]))
  for (const pair of pairs) for (const point of pair.pointsToConnect) expect(input.connections[0]!.pointsToConnect).toContainEqual(point)
  expect(candidate.layerAwareMstStats).toEqual({ completed: true, connectionsProcessed: 1, inputPointOccurrences: 3, inputDistinctLayerKeys: 3, mstCoveredLayerKeys: 3, missingLayerKeys: 0, coincidentCrossLayerGroups: 1, zeroDistanceLayerEdges: 1, mstSelectedEdges: 2 })
  expect(JSON.stringify(input)).toBe(before)
})
