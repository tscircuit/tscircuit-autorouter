import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

type KeyedNode = Node & { keyCallIndex?: number }
type KeyCall = {
  node: KeyedNode
  values: number[]
  ownKeys: string[]
  metadataBefore: number | undefined
}
type SolverWithCalls = SingleHighDensityRouteSolver & { keyCalls: KeyCall[] }

class CustomKeySolver extends SingleHighDensityRouteSolver {
  keyCalls: KeyCall[] = []

  override getNodeKey(node: KeyedNode): number {
    const index = this.keyCalls.length
    this.keyCalls.push({
      node,
      values: [node.x, node.y, node.z, node.g, node.h, node.f],
      ownKeys: Object.keys(node),
      metadataBefore: node.keyCallIndex,
    })
    node.keyCallIndex = index
    return 10000 + Math.round(node.x / 0.2) * 100 +
      Math.round(node.y / 0.2) * 10 + node.z
  }
}

const options: ConstructorParameters<typeof SingleHighDensityRouteSolver>[0] = {
  connectionName: "custom-keys",
  obstacleRoutes: [],
  minDistBetweenEnteringPoints: 0.2,
  bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
  A: { x: -0.8, y: -0.8, z: 0 },
  B: { x: 0.8, y: 0.8, z: 3 },
  layerCount: 4,
}
const expectedCoordinates = [
  [-0.2, -0.2, 1], [-0.2, 0, 1], [-0.2, 0.2, 1],
  [0, -0.2, 1], [0, 0.2, 1],
  [0.2, -0.2, 1], [0.2, 0, 1], [0.2, 0.2, 1],
  [0, 0, 0], [0, 0, 2], [0, 0, 3],
]

test("custom node keys receive every full candidate and preserve its identity", (): void => {
  const originalGetNodeKey = SingleHighDensityRouteSolver.prototype.getNodeKey
  try {
    for (const mode of ["subclass", "instance", "prototype"]) {
      if (mode === "prototype") {
        SingleHighDensityRouteSolver.prototype.getNodeKey =
          CustomKeySolver.prototype.getNodeKey
      }
      for (const allExplored of [false, true]) {
        const solver = mode === "subclass"
          ? new CustomKeySolver(options)
          : new SingleHighDensityRouteSolver(options) as SolverWithCalls
        solver.keyCalls = []
        if (mode === "instance") {
          solver.getNodeKey = CustomKeySolver.prototype.getNodeKey
        }
        const current: Node = {
          x: 0, y: 0, z: 1, g: 3, h: 5, f: 8,
          parent: { x: -0.2, y: -0.2, z: 1, g: 0, h: 0, f: 0, parent: null },
        }
        const visitedIndices = allExplored
          ? expectedCoordinates.map((_, index): number => index)
          : [0, 6, 8]
        for (const index of visitedIndices) {
          const [x, y, z] = expectedCoordinates[index]
          solver.exploredNodes.add(
            10000 + Math.round(x / 0.2) * 100 + Math.round(y / 0.2) * 10 + z,
          )
        }
        const neighbors = solver.getNeighbors(current) as KeyedNode[]
        expect(solver.keyCalls).toHaveLength(11)
        expect(solver.keyCalls.map((call): number[] => call.values)).toEqual(
          expectedCoordinates.map((coordinates): number[] => [
            ...coordinates, current.g, current.h, current.f,
          ]),
        )
        for (const call of solver.keyCalls) {
          expect(call.node.parent).toBe(current)
          expect(call.ownKeys).toEqual(["x", "y", "z", "g", "h", "f", "parent"])
          expect(call.metadataBefore).toBeUndefined()
        }
        const acceptedIndices = allExplored ? [] : [1, 2, 3, 4, 5, 7, 9, 10]
        expect(neighbors.map((node): number | undefined => node.keyCallIndex))
          .toEqual(acceptedIndices)
        for (const [index, neighbor] of neighbors.entries()) {
          expect(neighbor).toBe(solver.keyCalls[acceptedIndices[index]].node)
        }
      }
    }
  } finally {
    SingleHighDensityRouteSolver.prototype.getNodeKey = originalGetNodeKey
  }
})
