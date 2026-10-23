import { expect, test } from "bun:test"
import { ConnectivityMap } from "connectivity-map"
import { FindClearancePathSolver } from "@tscircuit/repair04"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import { createPipeline9ClearanceSearchOwnershipContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9ClearanceSearchOwnershipContext"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

test("private search net tokens keep a foreign pad blocking when its alias collides with another canonical net key", (): void => {
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["victim", "A", "B", "original_trace"], ["foreign", "connectivity_net0"]])
  const canonical = connMap.getNetConnectedToId("victim")!
  expect(canonical).toBe("connectivity_net0")
  expect(connMap.getNetConnectedToId(canonical)).not.toBe(canonical)
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    connections: [{ name: "victim", __rootConnectionNames: [canonical], pointsToConnect: [] }, { name: "foreign", __rootConnectionNames: [canonical], pointsToConnect: [] }],
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 0.4, height: 0.4, layers: ["top", "bottom"], connectedTo: [canonical] }] }
  const route: HighDensityRoute = { connectionName: "victim", rootConnectionName: canonical, traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0, pcb_port_id: "A" }, { x: 1, y: 0, z: 0, pcb_port_id: "B" }], vias: [] }
  const solve = (context: { srj: Omit<SimpleRouteJson, "traces"> & { traces: undefined }; routes: HighDensityRoute[] }): HighDensityRoute["route"] => {
    const solver = new FindClearancePathSolver({ ...context, routeIndex: 0, start: route.route[0]!, end: route.route.at(-1)!, bounds: srj.bounds,
      traceThickness: 0.1, traceClearance: 0.1, viaClearance: 0.1, gridSize: 0.05, viaHoleDiameter: 0.15, allowLayerChanges: false })
    solver.solve()
    const path = solver.getOutput()
    expect(path).not.toBeNull()
    return path!
  }
  const minimumPadDistance = (path: HighDensityRoute["route"]): number => Math.min(...path.slice(1).map((point, index) =>
    segmentToBoundsMinDistance(path[index]!, point, { minX: -0.2, maxX: 0.2, minY: -0.2, maxY: 0.2 })))
  const unsafePath = solve({ srj: { ...srj, traces: undefined }, routes: [route] })
  expect(minimumPadDistance(unsafePath)).toBe(0)
  const context = createPipeline9ClearanceSearchOwnershipContext({ srj, routes: [route], fixedObstacleRoutes: [], preloadedTraces: [], connMap })
  expect(context.routes[0]!.rootConnectionName).not.toBe(context.srj.obstacles[0]!.connectedTo[0])
  expect(minimumPadDistance(solve(context))).toBeGreaterThanOrEqual(0.15 - 1e-9)
  expect(route.rootConnectionName).toBe(canonical)
  expect(srj.obstacles[0]!.connectedTo).toEqual([canonical])
  expect(context.routeOwnerReads).toBe(1)
  expect(context.obstacleOwnerReads).toBe(1)
  const preload = { ...route, connectionName: "unregistered_fixed_0", preloadedTraceIndex: 0, preloadedRouteIndex: 0 }
  const originalSrj: SimpleRouteJson = { ...srj, traces: [{ type: "pcb_trace", pcb_trace_id: "original_trace", connection_name: "victim", route: [] }] }
  expect(createPipeline9ClearanceSearchOwnershipContext({ srj, routes: [], fixedObstacleRoutes: [preload], preloadedTraces: originalSrj.traces!, connMap }).routes[0]!.connectionName)
    .toBe(context.routes[0]!.connectionName)
  const currentWithInheritedIndex = { ...route, preloadedTraceIndex: 999 }
  expect(createPipeline9ClearanceSearchOwnershipContext({ srj, routes: [currentWithInheritedIndex], fixedObstacleRoutes: [], preloadedTraces: [], connMap }).routes[0]!.connectionName).toBe(context.routes[0]!.connectionName)
  const sectionOwners = new Map([["mutable_section", 0], [canonical, 0]])
  expect(createPipeline9ClearanceSearchOwnershipContext({ srj, routes: [{ ...route, connectionName: "mutable_section" }], fixedObstacleRoutes: [], preloadedTraces: originalSrj.traces!, preloadedSectionTraceIndexByConnection: sectionOwners, connMap }).routes[0]!.connectionName)
    .toBe(context.routes[0]!.connectionName)
  expect(() => createPipeline9ClearanceSearchOwnershipContext({ srj, routes: [{ ...route, connectionName: canonical }], fixedObstacleRoutes: [], preloadedTraces: originalSrj.traces!, preloadedSectionTraceIndexByConnection: sectionOwners, connMap }))
    .toThrow("registered alias conflicting with original preload")
  expect(() => createPipeline9ClearanceSearchOwnershipContext({ srj, routes: [{ ...route, connectionName: "mutable_section" }], fixedObstacleRoutes: [], preloadedTraces: originalSrj.traces!, preloadedSectionTraceIndexByConnection: new Map([["mutable_section", 99]]), connMap }))
    .toThrow("lost original preload")
  expect(() => createPipeline9ClearanceSearchOwnershipContext({ srj, routes: [], fixedObstacleRoutes: [{ ...preload, connectionName: canonical }], preloadedTraces: originalSrj.traces!, connMap }))
    .toThrow("registered alias conflicting with original preload")
  expect(() => createPipeline9ClearanceSearchOwnershipContext({ srj: { ...srj, obstacles: [{ ...srj.obstacles[0]!, connectedTo: ["unregistered_pad"] }] }, routes: [route], fixedObstacleRoutes: [], preloadedTraces: [], connMap }))
    .toThrow("unknown obstacle identity")
  expect(() => createPipeline9ClearanceSearchOwnershipContext({ srj, routes: [], fixedObstacleRoutes: [{ ...preload, rootConnectionName: "foreign" }], preloadedTraces: originalSrj.traces!, connMap }))
    .toThrow("uncertified root")
  expect(() => createPipeline9ClearanceSearchOwnershipContext({ srj, routes: [{ ...route, connectionName: "unregistered" }], fixedObstacleRoutes: [], preloadedTraces: [], connMap }))
    .toThrow("no certified connection")
})
