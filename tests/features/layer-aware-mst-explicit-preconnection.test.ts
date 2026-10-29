import { expect, test } from "bun:test"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import { getLayerAwareMstPointKey } from "lib/solvers/NetToPointPairsSolver/getLayerAwareMstPointKey"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import type { SimpleRouteJson } from "lib/types"

test("explicit original plated/external preconnections remain zero-work equivalences", () => {
  const input: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -1, minY: -1, maxX: 3, maxY: 1 }, obstacles: [], connections: [{ name: "net", externallyConnectedPointIds: [["top", "bottom"]], pointsToConnect: [
    { x: 0, y: 0, layer: "top", pointId: "top", pcb_port_id: "top" },
    { x: 0, y: 0, layer: "bottom", pointId: "bottom", pcb_port_id: "bottom" },
    { x: 2, y: 0, layer: "top", pointId: "other", pcb_port_id: "other" },
  ] }] }
  const solver = new NetToPointPairsSolver2_OffBoardConnection(input, {}, getInitiallyConnectedMapFromSimpleRouteJson(input), { pointKey: getLayerAwareMstPointKey })
  solver.solve()
  const pairs = solver.getNewSimpleRouteJson().connections
  expect(pairs.length).toBe(1)
  expect(pairs.every((pair) => pair.pointsToConnect.some((point) => point.pointId === "other"))).toBe(true)
  expect(solver.layerAwareMstStats?.completed).toBe(true)
  expect(solver.layerAwareMstStats?.missingLayerKeys).toBe(0)
  expect(solver.layerAwareMstStats?.inputDistinctLayerKeys).toBe(3)
  expect(solver.layerAwareMstStats?.mstCoveredLayerKeys).toBe(3)
})
