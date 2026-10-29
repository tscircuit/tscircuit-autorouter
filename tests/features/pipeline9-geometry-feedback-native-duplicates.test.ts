import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "tiny-hypergraph/lib/index"
import { PIPELINE9_DUPLICATE_PORT_PROXIMITY } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

class DuplicateFixtureSolver extends DuplicateCongestedPortSolver {
  materialize(useCount: number): SerializedHyperGraph {
    return this.duplicateCongestedPorts(new Map([["source", useCount]]))
  }
}

test("actual pinned native duplicate materialization stays inside the certificate displacement envelope", (): void => {
  const graph: SerializedHyperGraph = {
    regions: [{ regionId: "a", pointIds: ["source"], d: { center: { x: -1, y: 0 }, width: 2, height: 2 } },
      { regionId: "b", pointIds: ["source"], d: { center: { x: 1, y: 0 }, width: 2, height: 2 } }],
    ports: [{ portId: "source", region1Id: "a", region2Id: "b", d: { x: 0, y: 0, z: 0 } }],
  }
  const solver = new DuplicateFixtureSolver(graph, { duplicatePortProximity: PIPELINE9_DUPLICATE_PORT_PROXIMITY })
  for (const count of [2, 3, 10, 100]) {
    const materialized = solver.materialize(count)
    const duplicates = materialized.ports.filter((port) => port.portId !== "source")
    expect(duplicates).toHaveLength(count - 1)
    for (const port of duplicates) {
      const x = Number(port.d!.x), y = Number(port.d!.y)
      expect(Math.hypot(x, y)).toBeLessThan(PIPELINE9_DUPLICATE_PORT_PROXIMITY)
    }
  }
})
