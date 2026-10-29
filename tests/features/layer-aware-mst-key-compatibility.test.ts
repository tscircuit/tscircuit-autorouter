import { expect, test } from "bun:test"
import { buildMinimumSpanningTree, DisjointSet } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"
import { getLayerAwareMstPointKey } from "lib/solvers/NetToPointPairsSolver/getLayerAwareMstPointKey"
import type { ConnectionPoint } from "lib/types"

test("legacy bare XY and same-layer coincidence remain while availability order is immaterial", () => {
  const bare = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }]
  expect(buildMinimumSpanningTree(bare).length).toBe(1)
  const legacy = new DisjointSet(bare)
  expect(legacy.componentCount).toBe(2)
  expect(Object.hasOwn(legacy, "customPointKey")).toBe(false)
  const duplicate: ConnectionPoint[] = [{ x: 0, y: 0, layer: "top", pointId: "first" }, { x: 0, y: 0, layer: "top", pointId: "second" }]
  expect(buildMinimumSpanningTree(duplicate, { pointKey: getLayerAwareMstPointKey })).toEqual([])
  expect(getLayerAwareMstPointKey({ x: 0, y: 0, layers: ["bottom", "top", "top"] })).toBe(getLayerAwareMstPointKey({ x: 0, y: 0, layers: ["top", "bottom"] }))
  expect(getLayerAwareMstPointKey(duplicate[0]!)).not.toBe(getLayerAwareMstPointKey({ x: 0, y: 0, layer: "bottom" }))
  expect(() => getLayerAwareMstPointKey({ x: Number.NaN, y: 0, layer: "top" })).toThrow()
  expect(() => getLayerAwareMstPointKey({ x: 0, y: 0, layers: [] })).toThrow()
})
