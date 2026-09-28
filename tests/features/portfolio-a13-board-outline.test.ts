import { expect, test } from "bun:test"
import { HighDensitySolverA13WithDrcValidation } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13WithDrcValidation"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("A13 rejects node-local routes that cross the physical board outline", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "clipped-board-corner",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "a", x: -1, y: 1, z: 0 },
      { connectionName: "a", x: 1, y: 1, z: 0 },
    ],
  }
  const params = {
    nodeWithPortPoints: node,
    obstacles: [],
    layerCount: 2,
    traceThickness: 0.1,
    traceMargin: 0.1,
    viaDiameter: 0.3,
  }
  const nodeOnly = new HighDensitySolverA13WithDrcValidation(params)
  nodeOnly.solve()
  expect(nodeOnly.solved).toBeTrue()
  const physicalBoard = new HighDensitySolverA13WithDrcValidation({
    ...params,
    boardGeometry: {
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      outline: [
        { x: -3, y: -3 },
        { x: 3, y: -3 },
        { x: 3, y: -1 },
        { x: -1, y: 3 },
        { x: -3, y: 3 },
      ],
      minBoardEdgeClearance: 0.2,
    },
  })
  physicalBoard.solve()
  expect(physicalBoard.solved).toBeFalse()
  expect(physicalBoard.failed).toBeTrue()
  expect(physicalBoard.stats.boardDrcIssueCount).toBeGreaterThan(0)
  expect(physicalBoard.error).toContain("board")
})
