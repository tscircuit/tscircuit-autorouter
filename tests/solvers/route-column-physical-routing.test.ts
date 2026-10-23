import { expect, test } from "bun:test"
import { getFixedObstacleViolations } from "@tscircuit/repair04"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { RouteColumnIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/RouteColumnIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

test("shared graph output preserves endpoints, roots, actual clearance and layer transitions", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "crossing", center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0, 1],
    portPoints: [
      { connectionName: "a", rootConnectionName: "root-a", x: -3, y: 0, z: 0, pcb_port_id: "a-start" },
      { connectionName: "a", rootConnectionName: "root-a", x: 3, y: 0, z: 0, pcb_port_id: "a-end" },
      { connectionName: "b", rootConnectionName: "root-b", x: 0, y: -3, z: 0 },
      { connectionName: "b", rootConnectionName: "root-b", x: 0, y: 3, z: 1 },
    ],
  }
  const solver = new RouteColumnIntraNodeSolver({ nodeWithPortPoints: node, traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.1, layerCount: 2 })
  solver.solve()
  expect(solver.solved, solver.error ?? "failed").toBe(true)
  expect(solver.solvedRoutes).toHaveLength(2)
  expect(solver.solvedRoutes[0]!.startPcbPortId).toBe("a-start")
  expect(solver.solvedRoutes[0]!.endPcbPortId).toBe("a-end")
  expect(solver.solvedRoutes.map((route) => route.rootConnectionName)).toEqual(["root-a", "root-b"])
  expect(doPipeline9RoutesHaveCopperConflict({ left: solver.solvedRoutes[0]!, right: solver.solvedRoutes[1]!, clearance: 0.1, layerCount: 2 })).toBe(false)
  expect(solver.solvedRoutes.reduce((sum, route) => sum + route.vias.length, 0)).toBeGreaterThan(0)
  for (const [index, route] of solver.solvedRoutes.entries()) {
    const pair = solver.pairs[index]!
    expect(route.route[0]).toEqual({ x: pair[0].x, y: pair[0].y, z: pair[0].z })
    expect(route.route.at(-1)).toEqual({ x: pair[1].x, y: pair[1].y, z: pair[1].z })
    for (let i = 1; i < route.route.length; i++) {
      const a = route.route[i - 1]!, b = route.route[i]!
      if (a.z === b.z) continue
      expect(a.x).toBe(b.x)
      expect(a.y).toBe(b.y)
      expect(route.vias.some((via) => via.x === a.x && via.y === a.y)).toBe(true)
    }
  }
  const obstacle: Obstacle = { type: "rect", layers: ["top", "bottom"], center: { x: 0, y: 0 }, width: 1, height: 1, ccwRotationDegrees: 30, connectedTo: [] }
  const obstructed = new RouteColumnIntraNodeSolver({ nodeWithPortPoints: node, obstacles: [obstacle], traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.1, layerCount: 2 })
  obstructed.solve()
  expect(obstructed.solved, obstructed.error ?? "failed").toBe(true)
  expect(getFixedObstacleViolations({ srj: { ...obstructed.validationSrj, traces: undefined }, routes: obstructed.solvedRoutes, traceClearance: 0.1, viaClearance: 0.1 })).toHaveLength(0)
  expect(obstructed.counters.routeColumnFixedGeometryCheckCount).toBeGreaterThan(0)
  const congested = new RouteColumnIntraNodeSolver({ nodeWithPortPoints: { ...node, portPoints: node.portPoints.map((point) => ({ ...point, z: 0 })) }, traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.1, layerCount: 2 })
  congested.solve()
  expect(congested.solved).toBe(false)
  expect(congested.error).toContain("feasibility remains unknown")
  expect(congested.counters.routeColumnNewPricedColumnCount).toBeGreaterThan(0)
  expect(congested.counters.routeColumnRoundBudgetExhaustionCount).toBe(1)
})
