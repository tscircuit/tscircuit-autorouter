import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "../../lib/solvers/HighDensitySolver/IntraNodeSolver"

test("constructs connections when Map iterators lack helper methods", () => {
  const nativeEntries = Map.prototype.entries

  Object.defineProperty(Map.prototype, "entries", {
    configurable: true,
    value(this: Map<unknown, unknown>) {
      const iterator = nativeEntries.call(this)
      return {
        next: () => iterator.next(),
        [Symbol.iterator]() {
          return this
        },
      }
    },
  })

  try {
    const solver = new IntraNodeRouteSolver({
      nodeWithPortPoints: {
        capacityMeshNodeId: "node-1",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        portPoints: [
          { connectionName: "net-a", x: -1, y: 0, z: 0 },
          { connectionName: "net-a", x: 1, y: 0, z: 0 },
        ],
      },
    })

    expect(solver.unsolvedConnections).toEqual([
      {
        connectionName: "net-a",
        rootConnectionName: undefined,
        points: [
          { x: -1, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
      },
    ])
  } finally {
    Object.defineProperty(Map.prototype, "entries", {
      configurable: true,
      writable: true,
      value: nativeEntries,
    })
  }
})
