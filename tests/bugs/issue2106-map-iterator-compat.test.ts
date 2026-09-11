import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("IntraNodeRouteSolver handles MapIterator without Iterator.prototype.map (issue #2106)", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "node1",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    portPoints: [
      {
        connectionName: "net1",
        rootConnectionName: "root_net1",
        x: 0,
        y: 0,
        z: 0,
      },
      {
        connectionName: "net1",
        rootConnectionName: "root_net1",
        x: 2,
        y: 2,
        z: 0,
      },
    ],
  }

  // Find Iterator / MapIterator prototype chain
  const mapEntries = new Map().entries()
  const mapIteratorProto = Object.getPrototypeOf(mapEntries)
  const iteratorProto = Object.getPrototypeOf(mapIteratorProto)

  const originalMapIteratorMap = (mapIteratorProto as any).map
  const originalIteratorMap = (iteratorProto as any)?.map

  try {
    delete (mapIteratorProto as any).map
    if (iteratorProto) {
      delete (iteratorProto as any).map
    }

    const solver = new IntraNodeRouteSolver({
      nodeWithPortPoints,
    })

    expect(solver.unsolvedConnections).toHaveLength(1)
    expect(solver.unsolvedConnections[0].connectionName).toBe("net1")
    expect(solver.unsolvedConnections[0].rootConnectionName).toBe("root_net1")
    expect(solver.unsolvedConnections[0].points).toHaveLength(2)
  } finally {
    if (originalMapIteratorMap) {
      ;(mapIteratorProto as any).map = originalMapIteratorMap
    }
    if (originalIteratorMap && iteratorProto) {
      ;(iteratorProto as any).map = originalIteratorMap
    }
  }
})
