import { doSegmentsIntersect } from "@tscircuit/math-utils"
import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { makeCrossingSingleLayerNode } from "./test-helpers"

test("GrowShrinkHighDensityIntraNodeSolver immediately returns invalid geometry for impossible single-layer crossings", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeCrossingSingleLayerNode(),
  })

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.activeSubSolver).toBeNull()
  expect(solver.growthAttempts).toBe(0)
  expect(solver.iterations).toBe(0)
  expect(solver.stats.invalidGeometryFallback).toBe(true)
  expect(solver.solvedRoutes).toHaveLength(2)

  const [routeA, routeB] = solver.solvedRoutes.map((route) => route.route)
  expect(routeA.every((point) => point.z === 0)).toBe(true)
  expect(routeB.every((point) => point.z === 0)).toBe(true)
  expect(doSegmentsIntersect(routeA[0], routeA[1], routeB[0], routeB[1])).toBe(
    true,
  )
  expect(solver.visualize().lines).toHaveLength(2)
})
