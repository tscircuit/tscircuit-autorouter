import { expect, test } from "bun:test"
import { doSegmentsIntersect } from "@tscircuit/math-utils"
import type { NodeWithPortPoints, PortPoint } from "../../lib/types/high-density-types"
import { realizeSymbolicLaneOrders } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/realizeSymbolicLaneOrders"

test("symbolic pair-order propagation agrees with exhaustive permutation oracle on all three-wire boundary orders", () => {
  const permutations = [["A", "B", "C"], ["A", "C", "B"], ["B", "A", "C"], ["B", "C", "A"], ["C", "A", "B"], ["C", "B", "A"]]
  for (const left of permutations) for (const right of permutations) {
    const groups = [-1, 1].map((x, edge) => ({ id: `edge${edge}`, points: ["A", "B", "C"].map((name, i): PortPoint => ({ portPointId: `edge${edge}:${name}`, connectionName: name, x, y: i - 1, z: 0 })) }))
    const nodes: NodeWithPortPoints[] = [-2, 0, 2].map((x, cell) => {
      const pairs = ["A", "B", "C"].map((name): [PortPoint, PortPoint] => {
        const a = cell === 0 ? { portPointId: `left:${name}`, connectionName: name, x: -3, y: left.indexOf(name) - 1, z: 0 } : { ...groups[cell - 1]!.points.find((p) => p.connectionName === name)! }
        const b = cell === 2 ? { portPointId: `right:${name}`, connectionName: name, x: 3, y: right.indexOf(name) - 1, z: 0 } : { ...groups[cell]!.points.find((p) => p.connectionName === name)! }
        return [a, b]
      })
      return { capacityMeshNodeId: `cell${cell}`, center: { x, y: 0 }, width: 2, height: 4, portPoints: pairs.flat(), portPointsInPairs: pairs }
    })
    let oracle = false
    for (const first of permutations) for (const second of permutations) {
      const positions = [first, second]
      const mapped = nodes.map((node) => node.portPointsInPairs!.map((pair) => pair.map((p) => {
        const edge = p.portPointId!.startsWith("edge0") ? 0 : p.portPointId!.startsWith("edge1") ? 1 : -1
        return edge < 0 ? p : { ...p, y: positions[edge]!.indexOf(p.connectionName) - 1 }
      }) as [PortPoint, PortPoint]))
      if (mapped.every((pairs) => pairs.every((a, i) => pairs.slice(0, i).every((b) => !doSegmentsIntersect(a[0], a[1], b[0], b[1]))))) oracle = true
    }
    const result = realizeSymbolicLaneOrders(nodes, groups)
    expect(result.compatible).toBe(oracle)
    if (result.compatible) {
      expect(result.stats.symbolicLaneCrossingsAfter).toBe(0)
      for (const node of result.nodes) for (const point of node.portPoints) {
        if (point.portPointId!.startsWith("left:") || point.portPointId!.startsWith("right:")) expect(point).toEqual(nodes.find((n) => n.capacityMeshNodeId === node.capacityMeshNodeId)!.portPoints.find((p) => p.portPointId === point.portPointId)!)
      }
    }
  }
})
