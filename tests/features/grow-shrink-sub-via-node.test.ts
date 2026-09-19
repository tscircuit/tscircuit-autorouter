import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import nodeJson from "../fixtures/srj18-sample15-sub-via-node.json"

const node: NodeWithPortPoints = nodeJson

test("sub-via-sized nodes retain a routing budget after growing to fit a via", (): void => {
  const params = {
    nodeWithPortPoints: node,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    layerCount: 4,
    fallbackToInvalidGeometryOnFailure: false,
  }
  const cappedSolver = new GrowShrinkHighDensityIntraNodeSolver({
    ...params,
    maxGrowthAttempts: 3,
  })
  cappedSolver.solve()
  expect(cappedSolver.failed).toBeTrue()
  expect(cappedSolver.scaleFactor).toBe(8)

  const solver = new GrowShrinkHighDensityIntraNodeSolver(params)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.scaleFactor).toBe(16)
  expect(solver.stats.invalidGeometryFallback).not.toBe(true)
  expect(solver.solvedRoutes).toHaveLength(3)
  for (const route of solver.solvedRoutes) {
    const terminals = node.portPoints.filter(
      (point) => point.connectionName === route.connectionName,
    )
    for (const point of [route.route[0]!, route.route.at(-1)!]) {
      expect(
        terminals.some(
          (terminal) =>
            Math.abs(terminal.x - point.x) < 1e-8 &&
            Math.abs(terminal.y - point.y) < 1e-8 &&
            terminal.z === point.z,
        ),
      ).toBeTrue()
    }
    expect(route.traceThickness).toBe(params.traceWidth)
    expect(route.viaDiameter).toBe(params.viaDiameter)
  }
})
