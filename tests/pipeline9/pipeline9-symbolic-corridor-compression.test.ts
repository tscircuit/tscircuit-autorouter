import { expect, test } from "bun:test"
import { compileSymbolicCorridors } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/compileSymbolicCorridors"
import { createSymbolicCorridorGraph } from "../fixtures/createSymbolicCorridorGraph"

test("capacity corridor graph defers concrete slot assignment and propagates lane identities across three interfaces", () => {
  const graph = createSymbolicCorridorGraph()
  const result = compileSymbolicCorridors(graph)
  expect(result.applicable).toBe(true)
  expect(result.nodes).toHaveLength(4)
  expect(result.stats.symbolicCorridorCapacityEdges).toBe(3)
  expect(result.stats.symbolicCorridorAssignedSlots).toBe(6)
  expect(result.stats.symbolicCorridorAvoidedSlotAlternatives).toBe(18)
  expect(result.stats.symbolicLaneMovedPorts).toBeGreaterThan(0)
  expect(result.stats.symbolicLaneCrossingsBefore).toBeGreaterThan(0)
  expect(result.stats.symbolicLaneCrossingsAfter).toBe(0)
  const copies = new Map<string, Array<{ x: number; y: number; connectionName: string }>>()
  for (const node of result.nodes) {
    expect(node.portPointsInPairs).toHaveLength(2)
    for (const [a, b] of node.portPointsInPairs!) {
      expect(a.connectionName).toBe(b.connectionName)
      expect(a.nextPortPointId).toBe(b.portPointId)
      expect(b.prevPortPointId).toBe(a.portPointId)
      for (const port of [a, b]) {
        const previous = copies.get(port.portPointId!) ?? []
        previous.push({ x: port.x, y: port.y, connectionName: port.connectionName }); copies.set(port.portPointId!, previous)
      }
    }
  }
  for (const [id, points] of copies) if (!id.startsWith("tiny-terminal:")) { expect(points).toHaveLength(2); expect(points[0]).toEqual(points[1]) }
  const insufficient = createSymbolicCorridorGraph()
  insufficient.ports = insufficient.ports.filter((p) => !p.portId.startsWith("e1p") || p.portId === "e1p0")
  const blocked = compileSymbolicCorridors(insufficient)
  expect(blocked.applicable).toBe(false)
  expect(blocked.stats.symbolicCorridorCapacityRejectedProblems).toBe(1)
})
