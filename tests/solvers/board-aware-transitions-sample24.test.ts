import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { SingleTransitionWithPlanarRoutesSolver } from "lib/solvers/HighDensitySolver/SingleTransitionWithPlanarRoutesSolver"
import { hasViaObstacleCollision } from "lib/solvers/HyperHighDensitySolver/hasViaObstacleCollision"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import actual from "../fixtures/sample24-hdr77584-board-transitions.json"

test("actual77584 constructs two distinct through vias with raw context, peer barrels and fixed endpoints", () => {
  const node = structuredClone(actual.nodeWithPortPoints) as NodeWithPortPoints
  const connMap = new ConnectivityMap(actual.connectivityNetMap)
  const params = { ...actual.options, nodeWithPortPoints: node,
    connMap, obstacles: actual.obstacles as Obstacle[] }
  const before = JSON.stringify(params)
  const solver = new PortfolioSingleIntraNodeSolver(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.winningSolver).toBeInstanceOf(SingleTransitionWithPlanarRoutesSolver)
  expect(solver.solvedRoutes.length).toBe(2)
  const routes = solver.solvedRoutes
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i]!, pair = node.portPointsInPairs![i]!
    expect(route.connectionName).toBe(pair[0].connectionName)
    expect(route.rootConnectionName).toBe(pair[0].rootConnectionName)
    expect(route.route[0]).toEqual({ x: pair[0].x, y: pair[0].y, z: pair[0].z })
    expect(route.route.at(-1)).toEqual({ x: pair[1].x, y: pair[1].y, z: pair[1].z })
    expect(route.traceThickness).toBe(0.1)
    expect(route.viaDiameter).toBe(0.3)
    expect(route.vias.length).toBe(1)
    expect(route.vias[0]!.y).toBeLessThan(node.center.y - node.height / 2)
    for (const port of node.portPoints) {
      if (port.rootConnectionName === route.rootConnectionName) continue
      expect(Math.hypot(port.x - route.vias[0]!.x, port.y - route.vias[0]!.y)).toBeGreaterThanOrEqual(0.3 - 1e-9)
    }
    const peer = routes[1 - i]!
    // All wire layers are physical barrel layers with blind vias disabled.
    for (let j = 1; j < peer.route.length; j++) {
      const a = peer.route[j - 1]!, b = peer.route[j]!
      if (a.z === b.z) expect(pointToSegmentDistance(route.vias[0]!, a, b)).toBeGreaterThanOrEqual(0.3 - 1e-9)
    }
  }
  expect(Math.hypot(routes[0]!.vias[0]!.x - routes[1]!.vias[0]!.x,
    routes[0]!.vias[0]!.y - routes[1]!.vias[0]!.y)).toBeGreaterThanOrEqual(0.4 - 1e-9)
  expect(hasViaObstacleCollision({ routes, obstacles: params.obstacles, connMap,
    layerCount: 8, allowBlindAndBuriedVias: false, viaDiameter: 0.3,
    viaToPadClearance: 0.1, center: node.center, coordinateScale: 1 })).toBe(false)
  expect(JSON.stringify(params)).toBe(before)
})
