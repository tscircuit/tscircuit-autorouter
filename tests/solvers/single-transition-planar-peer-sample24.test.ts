import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { SingleTransitionIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import { SingleTransitionWithPlanarRoutesSolver } from "lib/solvers/HighDensitySolver/SingleTransitionWithPlanarRoutesSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { hasViaObstacleCollision } from "lib/solvers/HyperHighDensitySolver/hasViaObstacleCollision"
import type { SingleTransitionBoardContext } from "lib/solvers/HighDensitySolver/findSingleTransitionVia"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"
import actual from "../fixtures/sample24-hdr77893-peer-transition.json"

test("actual sample24 77893 places its through via beyond the foreign top wire sharing its projected endpoint", () => {
  const node = structuredClone(actual.nodeWithPortPoints) as NodeWithPortPoints
  const context: SingleTransitionBoardContext = { obstacles: actual.obstacles as Obstacle[],
    ...actual.options, coordinateScale: 1 }
  const before = JSON.stringify({ node, context })
  const flat = node.portPointsInPairs![0]!, transition = node.portPointsInPairs![1]!
  const single = new SingleTransitionIntraNodeSolver({ nodeWithPortPoints: node,
    viaDiameter: 0.3, traceThickness: 0.1, boardContext: context })
  expect(single.failed).toBe(true)
  expect(single.error).toContain("Expected 1 route")
  const uncoordinated = new SingleTransitionIntraNodeSolver({
    nodeWithPortPoints: { ...node, portPoints: [...transition], portPointsInPairs: [transition] },
    viaDiameter: 0.3, traceThickness: 0.1, boardContext: context,
  })
  expect(uncoordinated.solved).toBe(true)
  expect(pointToSegmentDistance(uncoordinated.solvedRoutes[0]!.vias[0]!, flat[0]!, flat[1]!)).toBeLessThan(0.3)
  const solver = new PortfolioSingleIntraNodeSolver({ ...actual.options,
    nodeWithPortPoints: node, obstacles: actual.obstacles as Obstacle[] })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.winningSolver).toBeInstanceOf(SingleTransitionWithPlanarRoutesSolver)
  const routes = solver.solvedRoutes
  expect(routes.length).toBe(2)
  expect(routes.map((route) => route.connectionName)).toEqual([flat[0]!.connectionName, transition[0]!.connectionName])
  expect(routes[0]!.vias).toEqual([])
  expect(routes[0]!.route).toEqual(flat.map((p) => ({ x: p.x, y: p.y, z: p.z })))
  const routed = routes[1]!, via = routed.vias[0]!
  expect(routed.vias.length).toBe(1)
  expect(routed.rootConnectionName).toBe(transition[0]!.rootConnectionName)
  expect(routed.route[0]).toEqual({ x: transition[0]!.x, y: transition[0]!.y, z: 5 })
  expect(routed.route.at(-1)).toEqual({ x: transition[1]!.x, y: transition[1]!.y, z: 7 })
  expect(via.x).toBeGreaterThan(node.center.x + node.width / 2)
  // The barrel spans TOP even though both transitioning wire legs are inner/bottom.
  expect(pointToSegmentDistance(via, flat[0]!, flat[1]!)).toBeGreaterThanOrEqual(0.3 - 1e-9)
  expect(hasViaObstacleCollision({ routes, obstacles: context.obstacles, layerCount: 8,
    allowBlindAndBuriedVias: false, viaDiameter: 0.3, viaToPadClearance: 0.1,
    center: node.center, coordinateScale: 1 })).toBe(false)
  expect(JSON.stringify({ node, context })).toBe(before)
})
