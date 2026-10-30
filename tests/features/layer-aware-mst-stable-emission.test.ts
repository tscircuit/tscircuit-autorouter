import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import { getLayerAwareMstPointKey } from "lib/solvers/NetToPointPairsSolver/getLayerAwareMstPointKey"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("additional layer bridges preserve every legacy pair's name and global position", () => {
  for (let seed = 0; seed < 128; seed++) {
    const input: SimpleRouteJson = {
      layerCount: 2, minTraceWidth: 0.1,
      bounds: { minX: -10, minY: -10, maxX: 30, maxY: 30 }, obstacles: [],
      connections: [
        { name: "unaffected", pointsToConnect: [
          { x: 15, y: 5, layer: "top", pointId: "u0" },
          { x: 17, y: 7, layer: "top", pointId: "u1" },
        ] },
        { name: "affected", pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "a" },
          { x: 0, y: 0, layer: "bottom", pointId: "b" },
          { x: 2 + seed / 64, y: (seed % 7) / 8, layer: "top", pointId: "c" },
          { x: 5, y: 2 + (seed % 11) / 16, layer: "top", pointId: "d" },
          { x: 5, y: 2 + (seed % 11) / 16, layer: "bottom", pointId: "e" },
        ] },
      ],
    }
    const unchanged = JSON.stringify(input)
    for (const Solver of [NetToPointPairsSolver, NetToPointPairsSolver2_OffBoardConnection]) {
      const legacy = new Solver(input, {}, getInitiallyConnectedMapFromSimpleRouteJson(input))
      const candidate = new Solver(input, {}, getInitiallyConnectedMapFromSimpleRouteJson(input), { pointKey: getLayerAwareMstPointKey })
      legacy.solve()
      candidate.solve()
      const before = legacy.getNewSimpleRouteJson().connections
      const after = candidate.getNewSimpleRouteJson().connections
      expect(after.slice(0, before.length)).toEqual(before)
      expect(after.length).toBe(before.length + 2)
      expect(after.slice(before.length).every(({ pointsToConnect: [a, b] }) => a.x === b.x && a.y === b.y && getLayerAwareMstPointKey(a) !== getLayerAwareMstPointKey(b))).toBe(true)
      expect(candidate.layerAwareMstStats?.missingLayerKeys).toBe(0)
      expect(candidate.layerAwareMstStats?.completed).toBe(true)
      expect(new Set(after.flatMap((pair) => pair.pointsToConnect.map((point) => point.pointId)))).toEqual(new Set(["u0", "u1", "a", "b", "c", "d", "e"]))
      expect(JSON.stringify(input)).toBe(unchanged)
      expect(Object.hasOwn(legacy, "layerAwareDeferredConnections")).toBe(false)
    }
  }
})
