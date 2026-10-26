import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9PhysicalRouteValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9PhysicalRouteValidator"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { splitThroughOnlyGlobalFreeNodes } from "lib/solvers/NodeDimensionSubdivisionSolver/splitThroughOnlyGlobalFreeNodes"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

function route(name: string, y: number, startZ: number, endZ: number): HighDensityRoute {
  return {
    connectionName: name, rootConnectionName: name, traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 277.85719892, y, z: startZ }, { x: 278.10359926, y, z: startZ }, { x: 278.10359926, y, z: endZ }, { x: 278.25719812, y, z: endZ }],
    vias: [{ x: 278.10359926, y }],
  }
}

test("through-only planning and post-shrink validation reject sample24's vias under NC copper", (): void => {
  const partial: CapacityMeshNode = { capacityMeshNodeId: "topology_merge_61138", center: { x: 278.05719852, y: 122.22539933 }, width: 0.3999992, height: 1.05000066, availableZ: [1, 2, 3, 5] }
  const full: CapacityMeshNode = { capacityMeshNodeId: "full-stack", center: { x: 278.95719812, y: 122.22539933 }, width: 1.4, height: 1.5, availableZ: [0, 1, 2, 3, 4, 5, 6, 7] }
  const policy = { layerCount: 8, allowBlindAndBuriedVias: false, allowViaInPad: false }
  const snapshot = structuredClone(partial)
  const split = splitThroughOnlyGlobalFreeNodes([partial, full], policy)
  expect(split).toHaveLength(5)
  expect(split[4]).toBe(full)
  expect(split.slice(0, 4).map((node) => node.availableZ)).toEqual([[1], [2], [3], [5]])
  expect(new Set(split.map((node) => node.capacityMeshNodeId)).size).toBe(5)
  for (const node of split.slice(0, 4)) {
    expect(node.center).toEqual(partial.center)
    expect(node.width).toBe(partial.width)
    expect(node.height).toBe(partial.height)
  }
  expect(partial).toEqual(snapshot)
  const edgeSolver = new CapacityMeshEdgeSolver(split)
  edgeSolver.solve()
  // Every partial layer can reach the adjacent full stack, while coincident
  // single-layer copies have no edge that could fabricate a blind via.
  expect(edgeSolver.edges).toHaveLength(4)
  expect(edgeSolver.edges.every((edge) => edge.nodeIds.includes(full.capacityMeshNodeId))).toBe(true)
  for (const role of [{ _containsObstacle: true }, { _containsTarget: true }, { _isComponentTopologyNode: true }, { _isNarrowQfpPadGap: true }, { _connectedTo: ["owner"] }, { _targetConnectionName: "owner" }, { _offBoardConnectionId: "offboard" }, { _parent: full }, { unknownRole: false }]) {
    const protectedNode = { ...partial, ...role } as CapacityMeshNode
    expect(splitThroughOnlyGlobalFreeNodes([protectedNode], policy)[0]).toBe(protectedNode)
  }
  const original = [partial, full]
  expect(splitThroughOnlyGlobalFreeNodes(original, { ...policy, allowBlindAndBuriedVias: true })).toBe(original)
  expect(splitThroughOnlyGlobalFreeNodes(original, { ...policy, allowViaInPad: true })).toBe(original)

  const first = route("net112", 122.137699665, 3, 2)
  const second = route("net142", 122.387699665, 2, 1)
  const srj: SimpleRouteJson = {
    layerCount: 8, allowBlindAndBuriedVias: false, minTraceWidth: 0.1,
    bounds: { minX: 275, maxX: 281, minY: 119, maxY: 126 },
    obstacles: [{ type: "rect", layers: ["bottom"], center: { x: 278.05719852, y: 122.22539944 }, width: 0.3999992, height: 1.05000044, connectedTo: [], circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_altium_8300", pcb_port_id: "pcb_port_altium_8300" } }],
    connections: [],
  }
  const connMap = new ConnectivityMap({ n112: ["net112"], n142: ["net142"] })
  const validator = createPipeline9PhysicalRouteValidator({ physicalSrj: srj, connMap, obstacleMargin: 0.15, viaHoleDiameter: 0.15 })
  expect(validator([first])).toBe(false)
  expect(createPipeline9PhysicalRouteValidator({ physicalSrj: srj, connMap, obstacleMargin: 0.15, viaHoleDiameter: 0.15 })).toBe(validator)
  const empty = { ...srj, obstacles: [] }
  const peerValidator = createPipeline9PhysicalRouteValidator({ physicalSrj: empty, connMap, obstacleMargin: 0.15 })
  expect(peerValidator([first, second])).toBe(false)
  const sameNetVia = { ...second, connectionName: first.connectionName, rootConnectionName: first.rootConnectionName }
  expect(peerValidator([first, sameNetVia])).toBe(true)
  expect(createPipeline9PhysicalRouteValidator({ physicalSrj: { ...empty, minViaHoleEdgeToViaHoleEdgeClearance: 0.11 }, connMap, obstacleMargin: 0.15 })([first, sameNetVia])).toBe(false)
  const closeWires = [first, second].map((candidate, index) => ({ ...candidate, route: [{ x: 277.8, y: 122 + index * 0.225, z: 0 }, { x: 278.3, y: 122 + index * 0.225, z: 0 }], vias: [] }))
  expect(peerValidator(closeWires)).toBe(true)
  const blindValidator = createPipeline9PhysicalRouteValidator({ physicalSrj: { ...empty, allowBlindAndBuriedVias: true }, connMap, obstacleMargin: 0.15 })
  expect(blindValidator([route("net112", 122.137699665, 0, 1), route("net142", 122.137699665, 6, 7)])).toBe(true)
  expect(blindValidator([route("net112", 122.137699665, 0, 1), route("net142", 122.137699665, 1, 2)])).toBe(false)
  const grown = [first, second].map((candidate) => ({ ...candidate, route: candidate.route.map((point) => ({ ...point, x: partial.center.x + 2 * (point.x - partial.center.x), y: partial.center.y + 2 * (point.y - partial.center.y) })), vias: candidate.vias.map((point) => ({ x: partial.center.x + 2 * (point.x - partial.center.x), y: partial.center.y + 2 * (point.y - partial.center.y) })) }))
  expect(peerValidator(grown)).toBe(true)
  const sameNetPad = { ...srj, obstacles: srj.obstacles.map((obstacle) => ({ ...obstacle, connectedTo: ["net112"] })) }
  const ownWire = { ...first, route: [{ x: 277.95, y: 122.1, z: 7 }, { x: 278.15, y: 122.2, z: 7 }], vias: [] }
  expect(createPipeline9PhysicalRouteValidator({ physicalSrj: sameNetPad, connMap, obstacleMargin: 0.15 })([ownWire])).toBe(true)
  const rawKeepout = { ...srj, obstacles: srj.obstacles.map((obstacle) => ({ ...obstacle, circuitJsonMetadata: undefined })) }
  expect(createPipeline9PhysicalRouteValidator({ physicalSrj: rawKeepout, connMap, obstacleMargin: 0.15 })([first])).toBe(false)
  const outsideBoard = { ...empty, bounds: { ...empty.bounds, maxX: 278.2 } }
  expect(createPipeline9PhysicalRouteValidator({ physicalSrj: outsideBoard, connMap, obstacleMargin: 0.15 })([first])).toBe(false)
  const legal = { ...first, route: [first.route[0]!, { x: 279, y: first.route[0]!.y, z: 3 }, { x: 279, y: first.route[0]!.y, z: 2 }, first.route.at(-1)!], vias: [{ x: 279, y: first.route[0]!.y }] }
  expect(validator([legal])).toBe(true)

  const nodeWithPorts = { ...partial, portPoints: [], portPointsInPairs: [] }
  const parameters = { nodePortPoints: [nodeWithPorts], fixedHdRoutes: [], connMap, obstacles: [], physicalSrj: srj, layerCount: 8, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1 }
  const regular = new Pipeline9HighDensitySolver(parameters)
  regular.step()
  expect(regular.activeRegularSolver!.growShrinkSolutionValidator!([first])).toBe(false)
  const regional = new Pipeline9RegionalFallbackSolver({ ...parameters, nodeWithPortPoints: nodeWithPorts, colorMap: {} })
  expect(regional.highDensitySolver.growShrinkSolutionValidator!([first])).toBe(false)
  expect(regional.highDensitySolver.growShrinkSolutionValidator!([legal])).toBe(true)
  const { connMap: _, ...serializable } = parameters
  expect(() => structuredClone({ ...serializable, connectivityNetMap: connMap.netMap })).not.toThrow()
})
