import { distance } from "@tscircuit/math-utils"
import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

class OriginalFuturePenaltySolver extends SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost {
  override getFutureConnectionPenalty(node: Node, isVia: boolean): number {
    const point = this.getClosestFutureConnectionPoint(node)
    const goalDistance = distance(node, this.B)
    if (!point) return 0
    const pointDistance = distance(node, point)
    if (goalDistance <= pointDistance) return 0
    const distanceRatio =
      pointDistance / (this.viaDiameter * this.FUTURE_CONNECTION_PROXIMITY_VD)
    const maximumPenalty = isVia
      ? this.straightLineDistance * this.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR
      : this.straightLineDistance * this.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR
    return maximumPenalty * Math.exp(-distanceRatio * 5)
  }
}

test("future distance reuse preserves costs and refreshes mutated cached point distances", (): void => {
  const points = [
    { x: -0.1, y: 0, z: 0 },
    { x: 0.1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
  ]
  const options = {
    connectionName: "current",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.05,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: -2, z: 0 },
    B: { x: 2, y: 2, z: 0 },
    layerCount: 3,
    futureConnections: [{ connectionName: "future", points }],
    captureSearchDebug: false,
  }
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(options)
  const original = new OriginalFuturePenaltySolver(options)
  const parent: Node = { x: -0.2, y: -0.2, z: 0, g: 1, h: 2, f: 3, parent: null }
  const node: Node = { x: 0, y: 0, z: 0, g: 0, h: 0, f: 0, parent }
  const result = new Float64Array(1)
  const firstPoint = solver.getClosestFutureConnectionPoint(node, result)!
  expect(result[0]).toBe(distance(node, firstPoint))
  original.getClosestFutureConnectionPoint(node)
  firstPoint.x = 0.07
  firstPoint.y = 0.03
  expect(solver.getClosestFutureConnectionPoint(node, result)).toBe(firstPoint)
  expect(result[0]).toBe(distance(node, firstPoint))

  for (const query of [
    node,
    { ...node, x: 0.004, y: 0.005 },
    { ...node, z: 1 },
    { ...node, z: 2 },
    { ...node, x: -10, y: 10 },
    { ...node, x: Number.POSITIVE_INFINITY },
    node,
  ]) {
    for (const viaPenalty of [0, 0.3, 2]) {
      solver.VIA_PENALTY_FACTOR = original.VIA_PENALTY_FACTOR = viaPenalty
      for (const isVia of [false, true]) {
        expect(solver.getFutureConnectionPenalty(query, isVia)).toBe(
          original.getFutureConnectionPenalty(query, isVia),
        )
        expect(solver.getFutureConnectionPenalty({ ...query }, isVia)).toBe(
          original.getFutureConnectionPenalty({ ...query }, isVia),
        )
      }
      expect(solver.computeG(query)).toBe(original.computeG(query))
      expect(solver.computeH(query)).toBe(original.computeH(query))
      const reusedCostNode = { ...query }
      const originalCostNode = { ...query }
      solver.setNodeCosts(reusedCostNode)
      original.setNodeCosts(originalCostNode)
      expect(reusedCostNode).toEqual(originalCostNode)
    }
  }

  solver.futureConnectionPoints = original.futureConnectionPoints = []
  expect(solver.getClosestFutureConnectionPoint(node, result)).toBeNull()
  expect(result[0]).toBe(Infinity)
  expect(solver.getFutureConnectionPenalty(node, false)).toBe(0)
  solver.futureConnectionPoints = original.futureConnectionPoints = [points[1]]
  expect(solver.getFutureConnectionPenalty(node, false)).toBe(
    original.getFutureConnectionPenalty(node, false),
  )
})
