import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import node from "../fixtures/am3352-crowded-node.json"

test("crowded AM3352 terminals retain a search budget after growing to fit trace width", (): void => {
  const params = {
    nodeWithPortPoints: node as NodeWithPortPoints,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    layerCount: 4,
    rejectOverlappingTerminals: true,
    enableNegotiatedSearch: false,
    gridSearchSegmentWork: 500,
    gridSearchWorkScale: 0.25,
    fallbackToInvalidGeometryOnFailure: false,
  }
  const capped = new GrowShrinkHighDensityIntraNodeSolver({
    ...params,
    maxGrowthAttempts: 3,
  })
  capped.solve()
  expect(capped.failed).toBe(true)
  const solver = new GrowShrinkHighDensityIntraNodeSolver(params)
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.error).toBeNull()
  expect(solver.stats.invalidGeometryFallback).not.toBe(true)
  expect(new Set(solver.solvedRoutes.map((route) => route.connectionName))).toEqual(
    new Set(node.portPoints.map((point) => point.connectionName)),
  )
  for (const route of solver.solvedRoutes) {
    for (const endpoint of [route.route[0]!, route.route.at(-1)!]) {
      expect(node.portPoints.some((port) =>
        port.connectionName === route.connectionName &&
        Math.hypot(port.x - endpoint.x, port.y - endpoint.y) < 1e-8 &&
        port.z === endpoint.z,
      )).toBe(true)
    }
    expect(route.traceThickness).toBe(0.1)
    expect(route.viaDiameter).toBe(0.3)
  }
})
