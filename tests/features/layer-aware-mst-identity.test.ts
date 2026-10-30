import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"
import { getLayerAwareMstPointKey } from "lib/solvers/NetToPointPairsSolver/getLayerAwareMstPointKey"
import type { ConnectionPoint } from "lib/types"

test("MST preserves coincident opposite-layer requirements and a zero-distance connecting edge", () => {
  const points: ConnectionPoint[] = [
    { x: 0, y: 0, layer: "top", pointId: "top", pcb_port_id: "top" },
    { x: 0, y: 0, layer: "bottom", pointId: "bottom", pcb_port_id: "bottom" },
    { x: 2, y: 0, layer: "top", pointId: "other", pcb_port_id: "other" },
  ]
  for (const point of points) Object.freeze(point)
  Object.freeze(points)
  const before = JSON.stringify(points)
  const legacy = buildMinimumSpanningTree(points)
  const actual = buildMinimumSpanningTree(points, { pointKey: getLayerAwareMstPointKey })
  expect(legacy.length).toBe(1)
  expect(actual.length).toBe(2)
  expect(new Set(actual.flatMap((edge) => [getLayerAwareMstPointKey(edge.from), getLayerAwareMstPointKey(edge.to)]))).toEqual(new Set(points.map(getLayerAwareMstPointKey)))
  const zero = actual.filter((edge) => edge.from.x === edge.to.x && edge.from.y === edge.to.y)
  expect(zero.length).toBe(1)
  expect(new Set([zero[0]!.from.pointId, zero[0]!.to.pointId])).toEqual(new Set(["top", "bottom"]))
  expect(JSON.stringify(points)).toBe(before)
})
