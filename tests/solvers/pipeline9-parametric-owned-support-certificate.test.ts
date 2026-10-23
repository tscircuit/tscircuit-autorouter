import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9CellInterfaceSupport } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9CellInterfaceSupport"
import { constructPipeline9ParametricCell } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9ParametricCell"
import type { HighDensityRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"

test("owned support certifies only exact normal terminal escapes and contained width/layer/via support", (): void => {
  const pair: [PortPoint, PortPoint] = [
    { connectionName: "branch", rootConnectionName: "net", portPointId: "left", x: -2, y: -0.5, z: 0 },
    { connectionName: "branch", rootConnectionName: "net", portPointId: "right", x: 2, y: 0.5, z: 0 },
  ]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "owned", center: { x: 0, y: 0 }, width: 4, height: 4, portPoints: pair, portPointsInPairs: [pair] }
  for (const traceWidth of [0.1, 0.4]) {
    const interfacePortPoints = pair.map((port) => ({ capacityMeshNodeId: node.capacityMeshNodeId, port, traceWidth }))
    const physical = { node, pair, traceWidth, viaDiameter: 0.5, clearance: 0.15, layerCount: 4, interfacePortPoints }
    const support = createPipeline9CellInterfaceSupport(physical)!
    expect(support.terminalEscapeCount).toBe(2)
    const route: HighDensityRoute = { connectionName: "branch", rootConnectionName: "net", traceThickness: traceWidth, viaDiameter: 0.5, vias: [], route: [pair[0], ...support.coreEndpoints, pair[1]] }
    expect(support.certify(route)).toBe(true)
    expect(support.coreEndpoints[0].x).toBe(-2 + (traceWidth / 2 + 0.15 + 1e-6))
    expect(support.certify({ ...route, route: [pair[0], { x: -1, y: -1, z: 0 }, pair[1]] })).toBe(false)
    expect(support.certify({ ...route, route: [pair[0], { x: -2, y: 0, z: 0 }, ...support.coreEndpoints, pair[1]] })).toBe(false)
    expect(() => support.certify({ ...route, rootConnectionName: "foreign" })).toThrow("terminal identity")
    expect(() => support.certify({ ...route, route: [{ ...pair[0], z: 1 }, ...route.route.slice(1)] })).toThrow("terminal identity")
    expect(() => support.certify({ ...route, traceThickness: traceWidth + 0.1 })).toThrow("width")
    const constructed = constructPipeline9ParametricCell({ node, traceWidth: 0.1, traceWidthByConnection: { branch: traceWidth }, viaDiameter: 0.5, obstacleMargin: 0.15, layerCount: 4, obstacles: [], connMap: new ConnectivityMap({}), interfacePolicy: "owned-normal-escapes", interfacePortPoints })
    expect(constructed.applicable).toBe(true)
    expect(constructed.routes[0]!.traceThickness).toBe(traceWidth)
    expect(constructed.routes.every((candidate) => support.certify(candidate))).toBe(true)
    expect(constructed.stats.parametricInterfaceCertifiedRoutes).toBe(1)
    expect(constructed.stats.parametricInterfaceNormalEscapeFormulas).toBeGreaterThan(0)
  }
  for (const patch of [{ portPointId: "unknown" }, { rootConnectionName: "foreign" }, { z: 1 }, { pcb_port_id: "foreign-pad" }]) {
    expect(() => createPipeline9CellInterfaceSupport({ node, pair: [{ ...pair[0], ...patch }, pair[1]], traceWidth: 0.1, viaDiameter: 0.5, clearance: 0.15, layerCount: 4, interfacePortPoints: pair.map((port) => ({ capacityMeshNodeId: node.capacityMeshNodeId, port, traceWidth: 0.1 })) })).toThrow("owner witness")
  }
  const anonymous = structuredClone(node)
  for (const port of anonymous.portPoints) delete port.portPointId
  expect(createPipeline9CellInterfaceSupport({ node: anonymous, pair: anonymous.portPoints as [PortPoint, PortPoint], traceWidth: 0.1, viaDiameter: 0.5, clearance: 0.15, layerCount: 4, interfacePortPoints: anonymous.portPoints.map((port) => ({ capacityMeshNodeId: anonymous.capacityMeshNodeId, port, traceWidth: 0.1 })) })).toBeNull()
  const corner = structuredClone(node)
  corner.portPoints[0]!.y = -2
  expect(createPipeline9CellInterfaceSupport({ node: corner, pair: corner.portPoints as [PortPoint, PortPoint], traceWidth: 0.1, viaDiameter: 0.5, clearance: 0.15, layerCount: 4, interfacePortPoints: corner.portPoints.map((port) => ({ capacityMeshNodeId: corner.capacityMeshNodeId, port, traceWidth: 0.1 })) })).toBeNull()
  const viaPair: [PortPoint, PortPoint] = [{ ...pair[0], x: -1 }, { ...pair[1], x: 1, z: 3 }]
  const viaNode: NodeWithPortPoints = { ...node, portPoints: viaPair, portPointsInPairs: [viaPair] }
  const interfacePortPoints = viaPair.map((port) => ({ capacityMeshNodeId: viaNode.capacityMeshNodeId, port, traceWidth: 0.1 }))
  const viaSupport = createPipeline9CellInterfaceSupport({ node: viaNode, pair: viaPair, traceWidth: 0.1, viaDiameter: 0.5, clearance: 0.15, layerCount: 4, interfacePortPoints })!
  const viaResult = constructPipeline9ParametricCell({ node: viaNode, traceWidth: 0.1, viaDiameter: 0.5, obstacleMargin: 0.15, layerCount: 4, obstacles: [], connMap: new ConnectivityMap({}), interfacePolicy: "owned-normal-escapes", interfacePortPoints })
  expect(viaResult.applicable).toBe(true)
  expect(viaResult.routes[0]!.vias).toHaveLength(1)
  expect(viaSupport.certify(viaResult.routes[0]!)).toBe(true)
  const boundaryVia: HighDensityRoute = { ...viaResult.routes[0]!, route: [viaPair[0], { x: -1.9, y: 0, z: 0 }, { x: -1.9, y: 0, z: 3 }, viaPair[1]], vias: [{ x: -1.9, y: 0 }] }
  expect(viaSupport.certify(boundaryVia)).toBe(false)
})
