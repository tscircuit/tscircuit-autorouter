import { expect, test } from "bun:test"
import { createPipeline9PhysicalRouteValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9PhysicalRouteValidator"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("physical ownership ignores geometric net unions and retains explicit child-route parents", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, layerCount: 8, minTraceWidth: 0.1,
    connections: ["signal", "foreign"].map((name) => ({ name, pointsToConnect: [{ x: 0, y: 0, layer: "inner1", pcb_port_id: `pcb_port_${name}` }] })),
    obstacles: ["signal", "foreign"].map((name) => ({ type: "rect", center: { x: 0, y: 0 }, width: 0.4, height: 1, layers: ["inner1"], connectedTo: [name, `pcb_smtpad_${name}`, `pcb_port_${name}`] })),
  }
  const routingMap = getConnectivityMapFromSimpleRouteJson(srj)
  expect(routingMap.areIdsConnected("signal", "foreign")).toBe(true)
  const via: HighDensityRoute = {
    connectionName: "signal", rootConnectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0.3, y: -0.5, z: 0 }, { x: 0.3, y: 0, z: 0 }, { x: 0.3, y: 0, z: 7 }, { x: 0.3, y: 0.5, z: 7 }], vias: [{ x: 0.3, y: 0 }],
  }
  expect(createPipeline9PhysicalRouteValidator({ physicalSrj: srj, connMap: routingMap, obstacleMargin: 0.15 })([via])).toBe(false)
  const ownOnly = { ...srj, obstacles: [srj.obstacles[0]!] }
  const validate = createPipeline9PhysicalRouteValidator({ physicalSrj: ownOnly, connMap: routingMap, obstacleMargin: 0.15 })
  const node = {
    capacityMeshNodeId: "owned-child", center: { x: 0.3, y: 0 }, width: 1, height: 1,
    availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
    portPoints: [
      { x: 0.3, y: -0.5, z: 0, connectionName: "child-route", rootConnectionName: "signal" },
      { x: 0.3, y: 0.5, z: 7, connectionName: "child-route", rootConnectionName: "signal" },
    ],
  }
  const solver = createPipeline9RegularNodeSolver({ nodeWithPortPoints: node, connMap: routingMap, colorMap: {}, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1, nodePfById: {}, obstacles: [], layerCount: 8, physicalRouteValidator: validate })
  const child = { ...via, connectionName: "child-route", rootConnectionName: routingMap.getNetConnectedToId("signal") }
  expect(solver.growShrinkSolutionValidator!([child])).toBe(true)
})
