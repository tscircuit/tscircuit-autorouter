import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "../../lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("complete MST preserves explicit zero-weight connectivity and original terminal identities", () => {
  const points = [101, 0, 100, 1].map((x) => ({
    x,
    y: 0,
    pointId: `terminal-${x}`,
    pcb_port_id: `port-${x}`,
  }))
  const originalOrder = [...points]
  const alreadyConnectedEdge = {
    from: points[0]!,
    to: points[1]!,
    weight: 0,
  }

  const edges = buildMinimumSpanningTree(points, {
    extraEdges: [alreadyConnectedEdge],
  })

  expect(edges).toHaveLength(3)
  expect(edges).toContain(alreadyConnectedEdge)
  expect(edges.reduce((total, edge) => total + edge.weight, 0)).toBe(2)
  expect(points).toEqual(originalOrder)
  for (const edge of edges) {
    expect(points.some((point) => point === edge.from)).toBe(true)
    expect(points.some((point) => point === edge.to)).toBe(true)
  }
})
