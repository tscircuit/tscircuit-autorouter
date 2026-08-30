import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { SingleTransitionCrossingRouteSolver } from "lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver"
import { pointToAngle } from "lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/calculateSideTraversal"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import {
  BOUNDARY_COORDINATE_TOLERANCE_MM,
  classifyPointInBounds,
} from "lib/utils/classifyPointInBounds"

test("single-transition boundary stages share one tolerance on sides and corners", async () => {
  const bounds = { minX: 0, maxX: 10, minY: 0, maxY: 10 }
  const acceptedBoundaryOffsetMm = BOUNDARY_COORDINATE_TOLERANCE_MM * 0.5
  const rejectedBoundaryOffsetMm = BOUNDARY_COORDINATE_TOLERANCE_MM * 1.1
  const acceptedBoundaryPoints = [
    { x: 5, y: 10 + acceptedBoundaryOffsetMm },
    { x: 10 + acceptedBoundaryOffsetMm, y: 5 },
    { x: 5, y: -acceptedBoundaryOffsetMm },
    { x: -acceptedBoundaryOffsetMm, y: 5 },
    {
      x: -acceptedBoundaryOffsetMm,
      y: 10 + acceptedBoundaryOffsetMm,
    },
    {
      x: 10 + acceptedBoundaryOffsetMm,
      y: 10 + acceptedBoundaryOffsetMm,
    },
    {
      x: 10 + acceptedBoundaryOffsetMm,
      y: -acceptedBoundaryOffsetMm,
    },
    { x: -acceptedBoundaryOffsetMm, y: -acceptedBoundaryOffsetMm },
  ]
  const rejectedBoundaryPoints = [
    { x: 5, y: 10 + rejectedBoundaryOffsetMm },
    { x: 10 + rejectedBoundaryOffsetMm, y: 5 },
    { x: 5, y: -rejectedBoundaryOffsetMm },
    { x: -rejectedBoundaryOffsetMm, y: 5 },
    {
      x: -rejectedBoundaryOffsetMm,
      y: 10 + rejectedBoundaryOffsetMm,
    },
    {
      x: 10 + rejectedBoundaryOffsetMm,
      y: 10 + rejectedBoundaryOffsetMm,
    },
    {
      x: 10 + rejectedBoundaryOffsetMm,
      y: -rejectedBoundaryOffsetMm,
    },
    { x: -rejectedBoundaryOffsetMm, y: -rejectedBoundaryOffsetMm },
  ]

  for (const point of acceptedBoundaryPoints) {
    expect(classifyPointInBounds({ point, bounds })).toBe("on-boundary")
    expect(() => pointToAngle(point, bounds)).not.toThrow()
  }

  for (const point of rejectedBoundaryPoints) {
    expect(classifyPointInBounds({ point, bounds })).toBe("outside")
    expect(() => pointToAngle(point, bounds)).toThrow(
      "does not lie on the boundary",
    )
  }

  const sideNodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "boundary-side-tolerance-node",
    center: { x: 5, y: 5 },
    width: 10,
    height: 10,
    portPoints: [
      {
        connectionName: "transition",
        x: 5,
        y: 10 + acceptedBoundaryOffsetMm,
        z: 0,
      },
      {
        connectionName: "transition",
        x: 5,
        y: -acceptedBoundaryOffsetMm,
        z: 1,
      },
      {
        connectionName: "flat",
        x: -acceptedBoundaryOffsetMm,
        y: 5,
        z: 0,
      },
      {
        connectionName: "flat",
        x: 10 + acceptedBoundaryOffsetMm,
        y: 5,
        z: 0,
      },
    ],
  }
  const cornerNodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "boundary-corner-tolerance-node",
    center: { x: 5, y: 5 },
    width: 10,
    height: 10,
    portPoints: [
      {
        connectionName: "transition",
        x: -acceptedBoundaryOffsetMm,
        y: 10 + acceptedBoundaryOffsetMm,
        z: 0,
      },
      {
        connectionName: "transition",
        x: 10 + acceptedBoundaryOffsetMm,
        y: -acceptedBoundaryOffsetMm,
        z: 1,
      },
      {
        connectionName: "flat",
        x: -acceptedBoundaryOffsetMm,
        y: -acceptedBoundaryOffsetMm,
        z: 0,
      },
      {
        connectionName: "flat",
        x: 10 + acceptedBoundaryOffsetMm,
        y: 10 + acceptedBoundaryOffsetMm,
        z: 0,
      },
    ],
  }

  for (const nodeWithPortPoints of [
    sideNodeWithPortPoints,
    cornerNodeWithPortPoints,
  ]) {
    const firstSolver = new SingleTransitionCrossingRouteSolver({
      nodeWithPortPoints,
    })
    const repeatedSolver = new SingleTransitionCrossingRouteSolver({
      nodeWithPortPoints,
    })

    expect(firstSolver.failed).toBe(false)
    expect(repeatedSolver.failed).toBe(false)
    expect(() => firstSolver.solve()).not.toThrow()
    expect(() => repeatedSolver.solve()).not.toThrow()
    expect(firstSolver.solved).toBe(true)
    expect(repeatedSolver.solved).toBe(true)
    expect(repeatedSolver.solvedRoutes).toEqual(firstSolver.solvedRoutes)
    expect(
      firstSolver.solvedRoutes.every((route) =>
        route.route.every(
          (point) =>
            point.x >= bounds.minX &&
            point.x <= bounds.maxX &&
            point.y >= bounds.minY &&
            point.y <= bounds.maxY,
        ),
      ),
    ).toBe(true)
  }

  const visualSolver = new SingleTransitionCrossingRouteSolver({
    nodeWithPortPoints: sideNodeWithPortPoints,
  })
  visualSolver.solve()

  await expect(
    getSvgFromGraphicsObject(visualSolver.visualize(), {
      backgroundColor: "#0d1b2a",
      svgWidth: 640,
      svgHeight: 480,
      hideInlineLabels: false,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })

  const outsideToleranceSolver = new SingleTransitionCrossingRouteSolver({
    nodeWithPortPoints: {
      ...sideNodeWithPortPoints,
      portPoints: sideNodeWithPortPoints.portPoints.map((portPoint, index) =>
        index === 3
          ? { ...portPoint, x: bounds.maxX + rejectedBoundaryOffsetMm }
          : portPoint,
      ),
    },
  })

  expect(outsideToleranceSolver.failed).toBe(true)
  expect(outsideToleranceSolver.error).toContain("outside node bounds")
})
