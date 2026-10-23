import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver, normalizePipeline9NodeRootConnectionNames } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { constructPipeline9ParametricCell } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9ParametricCell"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("canonical connection owners survive alias collisions and serialized reservations must match each actual owned terminal", (): void => {
  const connMap = new ConnectivityMap({ connectivity_net0: ["left-net"], connectivity_net1: ["connectivity_net0", "right-net"] })
  expect(connMap.getNetConnectedToId("connectivity_net0")).toBe("connectivity_net1")
  const nodes: NodeWithPortPoints[] = [
    { capacityMeshNodeId: "left", center: { x: 1, y: 2 }, width: 2, height: 4, portPoints: [
      { connectionName: "left-net", rootConnectionName: "connectivity_net0", portPointId: "left-a", x: 2, y: 2, z: 0 },
      { connectionName: "left-net", rootConnectionName: "connectivity_net0", portPointId: "left-b", x: 0.5, y: 2, z: 0 },
    ] },
    { capacityMeshNodeId: "right", center: { x: 3, y: 2 }, width: 2, height: 4, portPoints: [
      { connectionName: "right-net", rootConnectionName: "connectivity_net1", portPointId: "right-a", x: 2.225001, y: 0.5, z: 0 },
      { connectionName: "right-net", rootConnectionName: "connectivity_net1", portPointId: "right-b", x: 2.225001, y: 3.5, z: 0 },
    ] },
  ]
  const normalized = nodes.map((node) => normalizePipeline9NodeRootConnectionNames(node, connMap))
  expect(normalized[0]!.portPoints.every((port) => port.rootConnectionName === "connectivity_net0")).toBe(true)
  expect(normalized[1]!.portPoints.every((port) => port.rootConnectionName === "connectivity_net1")).toBe(true)
  const params = { nodePortPoints: nodes, connMap, enableParametricConstruction: true, fixedHdRoutes: [], obstacles: [], layerCount: 2, viaDiameter: 0.5, traceWidth: 0.15, obstacleMargin: 0.15, effort: 1 }
  const interfacePortPoints = normalized.flatMap((node) => node.portPoints.map((port) => ({ capacityMeshNodeId: node.capacityMeshNodeId, port, traceWidth: params.traceWidth })))
  expect(() => new Pipeline9HighDensitySolver({ ...params, parametricInterfacePortPoints: interfacePortPoints })).not.toThrow()
  const left = constructPipeline9ParametricCell({ ...params, node: normalized[0]!, interfacePolicy: "owned-normal-escapes", interfacePortPoints })
  const right = constructPipeline9ParametricCell({ ...params, node: normalized[1]!, interfacePolicy: "owned-normal-escapes", interfacePortPoints })
  expect(left.applicable).toBe(true)
  expect(right.stats.parametricInterfaceReservationChecks).toBeGreaterThan(0)
  if (right.applicable) expect(doPipeline9RoutesHaveCopperConflict({ left: left.routes[0]!, right: right.routes[0]!, layerCount: 2, clearance: 0.15 })).toBe(false)
  else expect(right.routes).toEqual([])
  for (const change of [{ x: 2.01 }, { z: 1 }, { portPointId: "unknown" }, { pcb_port_id: "foreign-pad" }, { rootConnectionName: "connectivity_net1" }, { connectionName: "right-net" }]) {
    const supplied = structuredClone(interfacePortPoints)
    Object.assign(supplied[0]!.port, change)
    expect(() => new Pipeline9HighDensitySolver({ ...params, parametricInterfacePortPoints: supplied })).toThrow(/reservation|foreign electrical root/)
  }
  const wrongWidth = structuredClone(interfacePortPoints)
  wrongWidth[0]!.traceWidth = 0.1
  expect(() => new Pipeline9HighDensitySolver({ ...params, parametricInterfacePortPoints: wrongWidth })).toThrow("reservation")
  expect(() => new Pipeline9HighDensitySolver({ ...params, parametricInterfacePortPoints: interfacePortPoints.slice(1) })).toThrow("reservation")
  const wrongRoot = structuredClone(nodes[0]!)
  wrongRoot.portPoints[0]!.rootConnectionName = "connectivity_net1"
  expect(() => normalizePipeline9NodeRootConnectionNames(wrongRoot, connMap)).toThrow("foreign electrical root")
})
