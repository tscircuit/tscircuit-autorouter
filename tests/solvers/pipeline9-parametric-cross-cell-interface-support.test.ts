import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { constructPipeline9ParametricCell } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9ParametricCell"
import { createPipeline9CellInterfaceSupport } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9CellInterfaceSupport"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"

test("owned cell interfaces reject new boundary copper while retaining exact normal escapes and distinguishing forced endpoint contacts", (): void => {
  const connMap = new ConnectivityMap({})
  // Exact simultaneous main-HD witnesses from Muse, before force or repair.
  const muse: NodeWithPortPoints = {
    capacityMeshNodeId: "topology_merge_16",
    center: { x: -26.074130999999998, y: 5.999999900000001 },
    width: 1.7999960000000002,
    height: 7.4502262,
    availableZ: [0, 1],
    portPoints: [
      { portPointId: "ce72_pp4_z0::0", x: -25.399133, y: 2.2748868, z: 0, connectionName: "source_net_3_mst16", rootConnectionName: "source_net_3" },
      { portPointId: "ce75_pp0_z0::0", x: -25.174132999999998, y: 6, z: 0, connectionName: "source_net_3_mst16", rootConnectionName: "source_net_3" },
    ],
  }
  const nativeVia: HighDensityRoute = {
    connectionName: "source_net_9", rootConnectionName: "source_net_9", traceThickness: 0.15, viaDiameter: 0.5,
    route: [{ x: -24.8, y: 3.7000000000000015, z: 0 }, { x: -24.8, y: 3.7000000000000015, z: 1 }],
    vias: [{ x: -24.8, y: 3.7000000000000015 }],
  }
  const params = { node: muse, connMap, obstacles: [], layerCount: 2, traceWidth: 0.15, viaDiameter: 0.5, obstacleMargin: 0.15 }
  const historical = constructPipeline9ParametricCell(params)
  expect(historical.applicable).toBe(true)
  expect(doPipeline9RoutesHaveCopperConflict({ left: historical.routes[0]!, right: nativeVia, layerCount: 2, clearance: 0.15 })).toBe(true)
  const certified = constructPipeline9ParametricCell({ ...params, interfacePolicy: "owned-normal-escapes",
    interfacePortPoints: muse.portPoints.map((port) => ({ capacityMeshNodeId: muse.capacityMeshNodeId, port, traceWidth: params.traceWidth })) })
  expect(certified.stats.parametricInterfacePairChecks).toBe(1)
  if (certified.applicable) {
    expect(certified.routes[0]!.route[0]).toEqual({ x: muse.portPoints[0]!.x, y: muse.portPoints[0]!.y, z: muse.portPoints[0]!.z })
    expect(certified.routes[0]!.route.at(-1)).toEqual({ x: muse.portPoints[1]!.x, y: muse.portPoints[1]!.y, z: muse.portPoints[1]!.z })
    expect(doPipeline9RoutesHaveCopperConflict({ left: certified.routes[0]!, right: nativeVia, layerCount: 2, clearance: 0.15 })).toBe(false)
  } else {
    expect(certified.routes).toEqual([])
    expect(certified.stats.parametricInterfaceUnsupportedPairs + certified.stats.parametricInterfaceCandidateRejections).toBeGreaterThan(0)
  }

  for (const scale of [0.5, 1, 4]) {
    const point = (x: number, y: number, connectionName: string, portPointId: string) => ({ x: x * scale, y: y * scale, z: 0, connectionName, portPointId })
    const left: NodeWithPortPoints = { capacityMeshNodeId: "left", center: { x: scale, y: 2 * scale }, width: 2 * scale, height: 4 * scale,
      portPoints: [point(0.5, 0, "left-net", "left-bottom"), point(2, 3.5, "left-net", "left-shared")] }
    const right: NodeWithPortPoints = { capacityMeshNodeId: "right", center: { x: 3 * scale, y: 2 * scale }, width: 2 * scale, height: 4 * scale,
      portPoints: [point(3.5, 0, "right-net", "right-bottom"), point(2, 3, "right-net", "right-shared")] }
    const common = { connMap, obstacles: [], layerCount: 2, traceWidth: 0.15 * scale, viaDiameter: 0.5 * scale, obstacleMargin: 0.15 * scale }
    const oldLeft = constructPipeline9ParametricCell({ ...common, node: left })
    const oldRight = constructPipeline9ParametricCell({ ...common, node: right })
    expect(oldLeft.applicable && oldRight.applicable).toBe(true)
    expect(doPipeline9RoutesHaveCopperConflict({ left: oldLeft.routes[0]!, right: oldRight.routes[0]!, layerCount: 2, clearance: common.obstacleMargin })).toBe(true)
    // Foreign endpoint spacing is 0.5*scale, greater than the 0.3*scale
    // required centerline separation. The old conflict is optional interior.
    expect(Math.hypot(left.portPoints[1]!.x - right.portPoints[1]!.x, left.portPoints[1]!.y - right.portPoints[1]!.y)).toBeGreaterThan(2 * common.traceWidth)
    const interfacePortPoints = [left, right].flatMap((node) => node.portPoints.map((port) => ({ capacityMeshNodeId: node.capacityMeshNodeId, port, traceWidth: common.traceWidth })))
    const nextLeft = constructPipeline9ParametricCell({ ...common, node: left, interfacePolicy: "owned-normal-escapes", interfacePortPoints })
    const nextRight = constructPipeline9ParametricCell({ ...common, node: right, interfacePolicy: "owned-normal-escapes", interfacePortPoints })
    expect(nextLeft.applicable && nextRight.applicable).toBe(true)
    expect(nextLeft.stats.parametricInterfaceCertifiedRoutes).toBe(1)
    expect(nextRight.stats.parametricInterfaceCertifiedRoutes).toBe(1)
    expect(nextLeft.stats.parametricInterfaceNormalEscapeFormulas).toBeGreaterThan(0)
    expect(nextRight.stats.parametricInterfaceNormalEscapeFormulas).toBeGreaterThan(0)
    expect(doPipeline9RoutesHaveCopperConflict({ left: nextLeft.routes[0]!, right: nextRight.routes[0]!, layerCount: 2, clearance: common.obstacleMargin })).toBe(false)
    for (const [result, node] of [[nextLeft, left], [nextRight, right]] as const) {
      const route = result.routes[0]!
      expect(route.route[0]).toEqual({ x: node.portPoints[0]!.x, y: node.portPoints[0]!.y, z: 0 })
      expect(route.route.at(-1)).toEqual({ x: node.portPoints[1]!.x, y: node.portPoints[1]!.y, z: 0 })
    }
  }

  // An optional core wire must also reserve a neighboring mandatory terminal
  // disk. Core containment alone does not compose with an owned normal escape.
  const left: NodeWithPortPoints = { capacityMeshNodeId: "escape-cell", center: { x: 1, y: 2 }, width: 2, height: 4,
    portPoints: [
      { portPointId: "escape-boundary", connectionName: "escape-net", x: 2, y: 2, z: 0 },
      { portPointId: "escape-interior", connectionName: "escape-net", x: 0.5, y: 2, z: 0 },
    ] }
  const right: NodeWithPortPoints = { capacityMeshNodeId: "core-cell", center: { x: 3, y: 2 }, width: 2, height: 4,
    portPoints: [
      { portPointId: "core-a", connectionName: "core-net", x: 2.225001, y: 0.5, z: 0 },
      { portPointId: "core-b", connectionName: "core-net", x: 2.225001, y: 3.5, z: 0 },
    ] }
  const interfacePortPoints = [left, right].flatMap((node) => node.portPoints.map((port) => ({ capacityMeshNodeId: node.capacityMeshNodeId, port, traceWidth: params.traceWidth })))
  const escape = constructPipeline9ParametricCell({ ...params, node: left, interfacePolicy: "owned-normal-escapes", interfacePortPoints })
  const unsafeCore = constructPipeline9ParametricCell({ ...params, node: right })
  expect(escape.applicable && unsafeCore.applicable).toBe(true)
  expect(doPipeline9RoutesHaveCopperConflict({ left: escape.routes[0]!, right: unsafeCore.routes[0]!, layerCount: 2, clearance: 0.15 })).toBe(true)
  const reservedCore = constructPipeline9ParametricCell({ ...params, node: right, interfacePolicy: "owned-normal-escapes", interfacePortPoints })
  if (reservedCore.applicable) {
    expect(doPipeline9RoutesHaveCopperConflict({ left: escape.routes[0]!, right: reservedCore.routes[0]!, layerCount: 2, clearance: 0.15 })).toBe(false)
  } else {
    expect(reservedCore.routes).toEqual([])
    expect(reservedCore.stats.parametricInterfaceCandidateRejections).toBeGreaterThan(0)
  }

  // Two forced terminal gaps may be imperfect while the exact connecting lead
  // still introduces a strictly worse interior overlap. Inheriting the first
  // terminal's contact cannot exempt that new penetration.
  const inwardX = params.traceWidth / 2 + params.obstacleMargin + 1e-6
  const leadNode: NodeWithPortPoints = { capacityMeshNodeId: "lead-cell", center: { x: 1, y: 2 }, width: 2, height: 4,
    portPoints: [
      { portPointId: "lead-boundary", connectionName: "lead-owner", x: 0, y: 2, z: 0 },
      { portPointId: "lead-core", connectionName: "lead-owner", x: inwardX, y: 2, z: 0 },
    ] }
  const foreignPort = { portPointId: "foreign-terminal", connectionName: "foreign-owner", x: 0.1, y: 2.14, z: 0 }
  const leadReservations = [...leadNode.portPoints.map((port) => ({ capacityMeshNodeId: leadNode.capacityMeshNodeId, port, traceWidth: params.traceWidth })),
    { capacityMeshNodeId: "foreign-cell", port: foreignPort, traceWidth: params.traceWidth }]
  const leadSupport = createPipeline9CellInterfaceSupport({ node: leadNode, pair: [leadNode.portPoints[0]!, leadNode.portPoints[1]!],
    traceWidth: params.traceWidth, viaDiameter: params.viaDiameter, clearance: params.obstacleMargin, layerCount: 2, interfacePortPoints: leadReservations })
  expect(leadSupport).not.toBeNull()
  const normalLead: HighDensityRoute = { connectionName: "lead-owner", traceThickness: params.traceWidth, viaDiameter: params.viaDiameter,
    route: leadNode.portPoints.map(({ x, y, z }) => ({ x, y, z })), vias: [] }
  for (const terminal of leadNode.portPoints) {
    const gap = Math.hypot(terminal.x - foreignPort.x, terminal.y - foreignPort.y) - params.traceWidth
    expect(gap).toBeGreaterThan(0)
    expect(gap).toBeLessThan(params.obstacleMargin)
  }
  expect(Math.abs(foreignPort.y - 2) - params.traceWidth).toBeLessThan(0)
  expect(leadSupport!.certify(normalLead)).toBe(false)

  // The other captured Muse contact is already forced by its exact terminal
  // disk; no alternative formula honoring that endpoint can make it clean.
  const forcedPort = { x: -19.744012162500002, y: 5.681249999999999, z: 0 }
  const unavoidableTerminal: HighDensityRoute = { connectionName: "source_net_5_mst2", rootConnectionName: "source_net_5", traceThickness: 0.15, viaDiameter: 0.5,
    route: [forcedPort, { ...forcedPort, y: 4.584952999999999 }], vias: [] }
  const adjacentVia: HighDensityRoute = { ...nativeVia, connectionName: "source_net_11_mst2", rootConnectionName: "source_net_11",
    route: [{ x: -19.987957100000003, y: 5.991997134146339, z: 0 }, { x: -19.987957100000003, y: 5.991997134146339, z: 1 }],
    vias: [{ x: -19.987957100000003, y: 5.991997134146339 }] }
  expect(doPipeline9RoutesHaveCopperConflict({ left: unavoidableTerminal, right: adjacentVia, layerCount: 2, clearance: 0.15 })).toBe(true)
  expect(Math.hypot(forcedPort.x - adjacentVia.vias[0]!.x, forcedPort.y - adjacentVia.vias[0]!.y) - 0.075 - 0.25).toBeCloseTo(0.07006064586597671, 12)
})
