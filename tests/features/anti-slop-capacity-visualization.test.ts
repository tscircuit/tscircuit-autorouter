import { expect, test } from "bun:test"
import type { Point3 } from "@tscircuit/math-utils"
import { getSvgFromGraphicsObject } from "graphics-debug"
import type { SegmentWithAssignedPoints } from "lib/solvers/CapacityMeshSolver/CapacitySegmentToPointSolver"
import { CapacitySegmentPointOptimizer } from "lib/solvers/CapacitySegmentPointOptimizer/CapacitySegmentPointOptimizer"
import type { CapacityMeshNode } from "lib/types"

test("capacity visualization keeps top, bottom and transition styling and omits nodes without segments", () => {
  const nodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "n1",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      layer: "top",
      availableZ: [0, 1],
      _containsTarget: true,
    },
    {
      capacityMeshNodeId: "unused",
      center: { x: 10, y: 10 },
      width: 4,
      height: 4,
      layer: "top",
      availableZ: [0, 1],
    },
  ]
  const assignedSegments: SegmentWithAssignedPoints[] = [-1, 1].map(
    (x): SegmentWithAssignedPoints => ({
      capacityMeshNodeId: "n1",
      start: { x, y: -1 },
      end: { x, y: 1 },
      availableZ: [0, 1],
      connectionNames: ["top", "bottom", "transition"],
      assignedPoints: [
        { connectionName: "top", point: { x, y: -0.5, z: 0 } },
        { connectionName: "bottom", point: { x, y: 0, z: 1 } },
        {
          connectionName: "transition",
          point: { x, y: 0.5, z: x === -1 ? 0 : 1 },
        },
      ],
    }),
  )
  const solver = new CapacitySegmentPointOptimizer({
    assignedSegments,
    nodes,
    colorMap: { top: "#ff0000", bottom: "#0000ff", transition: "#00ff00" },
  })
  const graphics = solver.visualize()
  expect(graphics.rects).toEqual([
    {
      center: { x: 0, y: 0 },
      label: "n1\n4.00x4.00",
      color: "red",
      width: 0.5,
      height: 0.5,
    },
  ])
  const connectionLines = graphics.lines!.slice(-3)
  expect(connectionLines.map((line) => line.strokeDash)).toEqual([
    undefined,
    "10 5",
    "3 3 10",
  ])
  expect(connectionLines.map((line) => line.strokeColor)).toEqual([
    "#ff0000",
    "#0000ff",
    "#00ff00",
  ])
  const expectedPoints: Point3[][] = [
    [
      { x: -1, y: -0.5, z: 0 },
      { x: 1, y: -0.5, z: 0 },
    ],
    [
      { x: -1, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
    [
      { x: -1, y: 0.5, z: 0 },
      { x: 1, y: 0.5, z: 1 },
    ],
  ]
  expect(connectionLines.map((line) => line.points)).toEqual(expectedPoints)
  const svg = getSvgFromGraphicsObject(graphics, { backgroundColor: "white" })
  expect(svg).toContain('stroke-dasharray="10 5"')
  expect(svg).toContain('stroke-dasharray="3 3 10"')
})
