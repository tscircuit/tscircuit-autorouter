import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"
import { getLayerAwareMstPointKey } from "lib/solvers/NetToPointPairsSolver/getLayerAwareMstPointKey"
import type { ConnectionPoint } from "lib/types"

test("layer-aware MST preserves all distinct physical requirements across seeded duplicate and tie cases", () => {
  let state = 36191
  for (let scenario = 0; scenario < 400; scenario++) {
    const points: ConnectionPoint[] = []
    for (let index = 0; index < 1 + scenario % 19; index++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      const x = state % 5
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      const y = state % 5
      points.push({ x, y, layer: scenario % 2 === 0 ? "top" : ["top", "inner1", "bottom"][state % 3]!, pointId: `point-${index}` })
    }
    const before = JSON.stringify(points)
    const edges = buildMinimumSpanningTree(points, { pointKey: getLayerAwareMstPointKey })
    const required = new Set(points.map(getLayerAwareMstPointKey))
    expect(edges.length).toBe(required.size - 1)
    if (required.size > 1) expect(new Set(edges.flatMap((edge) => [getLayerAwareMstPointKey(edge.from), getLayerAwareMstPointKey(edge.to)]))).toEqual(required)
    if (scenario % 2 === 0) expect(edges).toEqual(buildMinimumSpanningTree(points))
    expect(JSON.stringify(points)).toBe(before)
  }
})
