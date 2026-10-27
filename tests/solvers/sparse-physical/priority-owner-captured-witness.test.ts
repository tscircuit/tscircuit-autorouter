import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import captured from "./capturedOwnerReuse.json"

test("the captured cmn_330 witness keeps its original context and passes owner-aware final validation", (): void => {
  const solver = new PriorityDagIntraNodeSolver({
    nodeWithPortPoints: captured.node,
    connMap: new ConnectivityMap({
      [captured.owner]: [captured.route.connectionName],
    }),
    priorityFamilySize: 6,
    sparsePhysicalSearch: true,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    layerCount: 2,
    captureSearchDebug: false,
  })
  const tasks = solver["tasks"]
  const routeEnd = captured.route.route.at(-1)!
  const ancestorEnd = captured.ancestorRoute.route.at(-1)!
  const task = tasks.findIndex(
    (branch) =>
      branch.points[1].x === routeEnd.x &&
      branch.points[1].y === routeEnd.y &&
      branch.points[1].z === routeEnd.z,
  )
  const ancestor = tasks.findIndex(
    (branch) =>
      branch.points[1].x === ancestorEnd.x &&
      branch.points[1].y === ancestorEnd.y &&
      branch.points[1].z === ancestorEnd.z,
  )
  expect(task).toBe(0)
  expect(ancestor).toBe(1)
  const state: Parameters<PriorityDagIntraNodeSolver["validateRoute"]>[1] = {
    ancestors: tasks.map(() => new Set<number>()),
    witnesses: tasks.map(() => undefined),
  }
  solver["storeRoute"](captured.ancestorRoute, state, ancestor)
  state.ancestors[task].add(ancestor)
  solver["storeRoute"](captured.route, state, task)
  const options = solver["getOptions"](task, state)
  expect(options.obstacleRoutes).toHaveLength(1)
  expect(options.futureConnections).toHaveLength(1)
  expect(options.A).toEqual(captured.route.route[0])
  expect(options.B).toEqual(routeEnd)
  const checker = new Native(options)
  const via = captured.route.vias[0]
  expect(
    checker.isNodeTooCloseToObstacle(
      { ...via, z: 0, g: 0, h: 0, f: 0, parent: null },
      0.225,
      true,
    ),
  ).toBe(true)
  expect(solver["pairConflict"](ancestor, task, state)).toBe(false)
  const workBefore = solver.iterations
  const allowance = solver.MAX_ITERATIONS
  expect(solver["validateRoute"](task, state)).toBe(true)
  expect(solver.iterations).toBeGreaterThan(workBefore)
  expect(solver.MAX_ITERATIONS).toBe(allowance)
  expect(state.witnesses[task]!.route).toEqual(captured.route)
})
