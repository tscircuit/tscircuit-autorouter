import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("multi-head width is applied before capacity and copper-clearance calculations", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "parallel-node",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "lower", x: -0.5, y: -0.25, z: 0 },
      { connectionName: "lower", x: 0.5, y: -0.25, z: 0 },
      { connectionName: "upper", x: -0.5, y: 0.25, z: 0 },
      { connectionName: "upper", x: 0.5, y: 0.25, z: 0 },
    ],
  }
  const parallelLines: PolyLine2[] = [
    {
      connectionName: "lower",
      start: { x: -0.5, y: -0.25, z1: 0, z2: 0 },
      end: { x: 0.5, y: -0.25, z1: 0, z2: 0 },
      mPoints: [],
    },
    {
      connectionName: "upper",
      start: { x: -0.5, y: 0.25, z1: 0, z2: 0 },
      end: { x: 0.5, y: 0.25, z1: 0, z2: 0 },
      mPoints: [],
    },
  ]
  const viaAndTrace: PolyLine2[] = [
    {
      connectionName: "via",
      start: { x: 0, y: -0.25, z1: 0, z2: 1 },
      end: { x: 0, y: -0.25, z1: 1, z2: 1 },
      mPoints: [],
    },
    parallelLines[1]!,
  ]
  const originalNode = structuredClone(node)
  const originalLines = structuredClone(parallelLines)
  for (const example of [
    { width: undefined, capacity: 3 },
    { width: 0.1, capacity: 3 },
    { width: 0.3, capacity: 2 },
    { width: 0.5, capacity: 1 },
  ]) {
    const solver = new MultiHeadPolyLineIntraNodeSolver({
      nodeWithPortPoints: node,
      traceWidth: example.width,
      viaDiameter: 0.3,
    })
    const width = example.width ?? 0.15
    expect(solver.traceWidth).toBe(width)
    expect(solver.obstacleMargin).toBe(0.1)
    expect(solver.minViaCount).toBe(0)
    expect(solver.maxViaCount).toBe(example.capacity)
    expect(solver.computeMinGapBtwPolyLines(parallelLines)[0]).toBeCloseTo(
      0.5 - width,
      12,
    )
    expect(solver.computeMinGapBtwPolyLines(viaAndTrace)[0]).toBeCloseTo(
      0.5 - width / 2 - solver.viaDiameter / 2,
      12,
    )
  }
  expect(node).toEqual(originalNode)
  expect(parallelLines).toEqual(originalLines)
})
