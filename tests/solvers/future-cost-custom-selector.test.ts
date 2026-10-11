import { distance } from "@tscircuit/math-utils"
import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

class CustomFuturePointSolver extends SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost {
  selectedPoint: { x: number; y: number; z: number } | null = {
    x: 0.3,
    y: 0.1,
    z: 0,
  }

  override getClosestFutureConnectionPoint(
    node: Node,
  ): { x: number; y: number; z: number } | null {
    return this.selectedPoint
  }
}

test("future cost preserves one-argument custom point selectors", (): void => {
  const solver = new CustomFuturePointSolver({
    connectionName: "current",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.05,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: -2, z: 0 },
    B: { x: 2, y: 2, z: 0 },
    layerCount: 3,
    futureConnections: [
      {
        connectionName: "future",
        points: [{ x: -1, y: -1, z: 1 }],
      },
    ],
    captureSearchDebug: false,
  })
  const parent: Node = {
    x: -0.2,
    y: -0.2,
    z: 0,
    g: 1,
    h: 2,
    f: 3,
    parent: null,
  }
  const node: Node = { x: 0, y: 0, z: 0, g: 0, h: 0, f: 0, parent }
  for (const point of [
    { x: 0.3, y: 0.1, z: 0 },
    { x: 0.8, y: 0.5, z: 1 },
  ]) {
    solver.selectedPoint = point
    for (const isVia of [false, true]) {
      const maxPenalty =
        solver.straightLineDistance *
        (isVia
          ? solver.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR
          : solver.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR)
      const expectedPenalty =
        maxPenalty *
        Math.exp(
          -(
            distance(node, point) /
            (solver.viaDiameter * solver.FUTURE_CONNECTION_PROXIMITY_VD)
          ) * 5,
        )
      expect(solver.getFutureConnectionPenalty(node, isVia)).toBe(
        expectedPenalty,
      )
      expect(
        solver.getFutureConnectionPenalty(
          node,
          isVia,
          distance(node, solver.B),
        ),
      ).toBe(expectedPenalty)
    }
    const expectedG = solver.computeG(node)
    const expectedH = solver.computeH(node)
    solver.setNodeCosts(node)
    expect(node.g).toBe(expectedG)
    expect(node.h).toBe(expectedH)
    expect(node.f).toBe(solver.computeF(expectedG, expectedH))
  }
  solver.selectedPoint = null
  expect(solver.getFutureConnectionPenalty(node, false)).toBe(0)
})
