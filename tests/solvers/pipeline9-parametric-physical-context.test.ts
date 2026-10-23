import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { constructPipeline9ParametricCell } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9ParametricCell"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { constructPipeline9ParametricCellOracle } from "../fixtures/pipeline9ParametricCellOracle"

type Params = Parameters<typeof constructPipeline9ParametricCell>[0]

function compare(params: Params): ReturnType<typeof constructPipeline9ParametricCell> {
  const original = constructPipeline9ParametricCellOracle(params)
  const prepared = constructPipeline9ParametricCell(params)
  expect(prepared.applicable).toBe(original.applicable)
  expect(prepared.routes).toEqual(original.routes)
  for (const [key, value] of Object.entries(original.stats)) {
    expect(prepared.stats[key as keyof typeof prepared.stats]).toBe(value)
  }
  expect(prepared.stats.parametricPairConflictPredicates + prepared.stats.parametricPairConflictCacheHits).toBe(prepared.stats.parametricPairConflictQueries)
  expect(prepared.stats.parametricPeakPairConflictEntries).toBe(prepared.stats.parametricPairConflictStoredEntries)
  return prepared
}

test("prepared physical domains and ordered pair memo preserve the original geometry, ownership and bounded assignment decisions", (): void => {
  let broadphaseRejections = 0
  for (const scale of [0.75, 1, 4]) for (const offset of [-12, 0, 19]) for (const allowBlindAndBuriedVias of [false, true]) {
    const node: NodeWithPortPoints = { capacityMeshNodeId: "prepared", center: { x: offset, y: 0 }, width: 8 * scale, height: 8 * scale, availableZ: [0, 1, 2, 3], portPoints: [
      { connectionName: "elbow", x: offset - 3 * scale, y: -3 * scale, z: 0 },
      { connectionName: "elbow", x: offset + 3 * scale, y: 3 * scale, z: 0 },
      { connectionName: "transition", x: offset - 3 * scale, y: 2 * scale, z: 1 },
      { connectionName: "transition", x: offset + 3 * scale, y: 2 * scale, z: 3 },
    ] }
    const params: Params = { node, connMap: new ConnectivityMap({}), layerCount: 4, traceWidth: 0.1, traceWidthByConnection: { elbow: 0.2 }, viaDiameter: 0.3, obstacleMargin: 0.15,
      traceToPadClearance: 0.22, viaToPadClearance: 0.24, traceToHoleClearance: 0.2, allowBlindAndBuriedVias,
      boardGeometry: { bounds: { minX: offset - 20 * scale, maxX: offset + 20 * scale, minY: -20 * scale, maxY: 20 * scale }, minBoardEdgeClearance: 0.1 },
      obstacles: [
        { type: "rect", center: { x: offset, y: 0 }, width: scale, height: scale, ccwRotationDegrees: 30, layers: ["top"], connectedTo: [] },
        { type: "rect", shape: "circle", center: { x: offset, y: -2 * scale }, width: 0.4, height: 0.6, layers: ["inner1"], isNonPlatedHole: true, connectedTo: [] },
        { type: "rect", center: { x: offset + 40, y: 40 }, width: 0.6, height: 2, ccwRotationDegrees: 71, layers: ["top", "inner2"], connectedTo: [] },
      ] }
    const result = compare(params)
    broadphaseRejections += result.stats.parametricObstacleBroadphaseRejected
    expect(result.stats.parametricCellBoardCertified).toBe(1)
    const changed = structuredClone(params.obstacles)
    changed[2]!.center = { x: offset, y: 2 * scale }
    compare({ ...params, obstacles: changed })
    compare({ ...params, obstacles: [{ ...params.obstacles[0]!, center: { x: offset + 3.5 * scale, y: 0 }, width: scale, height: 4 * scale }] })
  }
  expect(broadphaseRejections).toBeGreaterThan(0)
  const crossing: Params = { node: { capacityMeshNodeId: "backtrack", center: { x: 0, y: 0 }, width: 8, height: 8,
    portPoints: [[[-3, -2], [3, 0]], [[-3, 2], [3, 1]], [[-2, -3], [2, 3]]].flatMap((pair, i) => pair.map((p) => ({ x: p[0]!, y: p[1]!, z: 0, connectionName: `net${i}` }))) },
    obstacles: [], connMap: new ConnectivityMap({}), layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1 }
  const repeated = compare(crossing)
  expect(repeated.stats.parametricPairConflictCacheHits).toBeGreaterThan(0)
  expect(repeated.stats.parametricAssignmentChecks).toBe(258)
  const owned = structuredClone(crossing.node)
  for (const point of owned.portPoints) point.rootConnectionName = "shared-root"
  compare({ ...crossing, node: owned })
  const sharedVias: NodeWithPortPoints = { ...crossing.node, portPoints: [0, 0.05].flatMap((y, i) => [
    { connectionName: `branch${i}`, rootConnectionName: "shared-root", x: -1, y, z: 0 },
    { connectionName: `branch${i}`, rootConnectionName: "shared-root", x: 1, y, z: 1 },
  ]) }
  compare({ ...crossing, node: sharedVias })
  const changingOwnership: Params = { ...crossing, node: { ...crossing.node, portPoints: [
    { connectionName: "net", x: -2, y: 0, z: 0 }, { connectionName: "net", x: 2, y: 0, z: 0 },
  ] }, obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 0.4, height: 0.4, layers: ["top"], connectedTo: ["pad"] }], connMap: new ConnectivityMap({}) }
  expect(compare(changingOwnership).applicable).toBe(false)
  changingOwnership.connMap.addConnections([["net", "pad"]])
  expect(compare(changingOwnership).applicable).toBe(true)
  const concave: Params = { ...crossing, boardGeometry: { bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 }, minBoardEdgeClearance: 0.1,
    outline: [{ x: -6, y: -6 }, { x: 6, y: -6 }, { x: 6, y: 6 }, { x: 1, y: 6 }, { x: 1, y: -1 }, { x: -1, y: -1 }, { x: -1, y: 6 }, { x: -6, y: 6 }] } }
  expect(compare(concave).stats.parametricCellBoardCertified).toBe(0)
  compare({ ...crossing, boardGeometry: { bounds: { minX: -4.25, maxX: 4.25, minY: -4.25, maxY: 4.25 }, minBoardEdgeClearance: 0.1 } })
  const mutable: Params = { ...crossing, obstacles: [{ type: "rect", center: { x: 30, y: 30 }, width: 1, height: 1, layers: ["top"], connectedTo: [] }] }
  compare(mutable)
  mutable.obstacles[0]!.center = { x: 0, y: 0 }
  mutable.obstacles[0]!.ccwRotationDegrees = 37
  compare(mutable)
  const epsilonNode = structuredClone(crossing.node)
  epsilonNode.portPoints = [{ connectionName: "edge", x: 4 + 5e-10, y: -1, z: 0 }, { connectionName: "edge", x: 4 + 5e-10, y: 1, z: 0 }]
  compare({ ...crossing, node: epsilonNode, obstacles: [{ type: "rect", center: { x: 4.45 + 1e-6, y: 0 }, width: 0.6, height: 2, layers: ["top"], connectedTo: [] }] })
  const params: Params = { ...crossing, layerCount: 4, node: { capacityMeshNodeId: "physical", center: { x: 0, y: 0 }, width: 8, height: 8, portPoints: [
    { connectionName: "elbow", x: -3, y: -3, z: 0 }, { connectionName: "elbow", x: 3, y: 3, z: 0 },
    { connectionName: "transition", x: -3, y: 2, z: 1 }, { connectionName: "transition", x: 3, y: 2, z: 3 },
  ] }, obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 1, height: 1, ccwRotationDegrees: 30, layers: ["top"], connectedTo: [] }] }
  params.node.portPoints.forEach((point, i) => {
    point.pcb_port_id = `terminal-${i}`
    params.obstacles.push({ type: "rect", center: { x: point.x, y: point.y }, width: 0.4, height: 0.4,
      layers: [mapZToLayerName(point.z, 4)], connectedTo: [point.pcb_port_id], circuitJsonMetadata: { pcb_port_id: point.pcb_port_id, pcb_smtpad_id: `pad-${i}` } })
  })
  params.connMap.addConnections(["elbow", "transition"].map((name) => [name, ...params.node.portPoints.filter((p) => p.connectionName === name).map((p) => p.pcb_port_id!)]))
  const result = compare(params)
  expect(result.applicable).toBe(true)
  const input: SimpleRouteJson = { bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 }, minBoardEdgeClearance: 0.1, minTraceWidth: 0.1, minViaDiameter: 0.3, layerCount: 4,
    obstacles: params.obstacles, connections: ["elbow", "transition"].map((name) => ({ name, pointsToConnect: params.node.portPoints.filter((p) => p.connectionName === name).map((p) => ({ x: p.x, y: p.y, layer: mapZToLayerName(p.z, 4), pcb_port_id: p.pcb_port_id, pointId: p.pcb_port_id })) })) }
  const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({ connections: input.connections, originalConnections: input.connections, hdRoutes: result.routes, layerCount: 4, obstacles: input.obstacles, defaultViaHoleDiameter: 0.15, connMap: params.connMap })
  expect(evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: input, routedTraces: traces, includeBoardClearance: true }).errors).toEqual([])
})
