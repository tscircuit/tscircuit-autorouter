import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("same-net polylines receive only their independent forces", (): void => {
  const lines: PolyLine2[] = [-0.1, 0.1].map((y, index) => ({
    connectionName: `branch${index}`,
    start: { x: -4, y, z1: 0, z2: 0 },
    end: { x: 4, y, z1: 0, z2: 0 },
    mPoints: [{ x: 0, y, z1: 0, z2: 0 }],
  }))
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "shared-net-forces",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    availableZ: [0, 1],
    portPoints: lines.flatMap((line) =>
      [line.start, line.end].map((point) => ({
        x: point.x,
        y: point.y,
        z: 0,
        connectionName: line.connectionName,
        rootConnectionName: "VREF",
      })),
    ),
  }
  const combined = new MultiHeadPolyLineIntraNodeSolver2({
    nodeWithPortPoints: node,
  })
  const actual = structuredClone(lines)
  combined.applyForcesToPolyLines(actual)
  const expected = lines.map((line) => {
    const independent = new MultiHeadPolyLineIntraNodeSolver2({
      nodeWithPortPoints: node,
    })
    const isolated = structuredClone(line)
    independent.applyForcesToPolyLines([isolated])
    return isolated
  })
  expect(actual).toEqual(expected)
  expect(combined.computeMinGapBtwPolyLines(lines)).toEqual([])

  const foreign = new MultiHeadPolyLineIntraNodeSolver2({
    nodeWithPortPoints: {
      ...node,
      portPoints: node.portPoints.map((port) => ({
        ...port,
        rootConnectionName: port.connectionName,
      })),
    },
  })
  const repelled = structuredClone(lines)
  foreign.applyForcesToPolyLines(repelled)
  expect(repelled).not.toEqual(expected)
  expect(foreign.computeMinGapBtwPolyLines(lines)).toHaveLength(1)
})
