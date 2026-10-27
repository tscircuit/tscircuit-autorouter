import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"
import { splitPartialLayerRegions } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/splitPartialLayerRegions"

const regionId = "topology_merge_74862__sub_0_1"
const actualRegionData = {
  capacityMeshNodeId: regionId,
  center: { x: 282.27898149500004, y: 69.99010066499999 },
  width: 1.1898550100000307,
  height: 0.2533993300000077,
  availableZ: [1, 2, 3, 6, 7],
}

function createActualPartialRegionGraph(sameLayer = false): SerializedHyperGraph {
  const points = sameLayer
    ? [
        { id: "same-start", x: 282.873909, y: 69.99010066499999, z: 2 },
        { id: "same-end", x: 282.873909, y: 70.039150575, z: 2 },
      ]
    : [
        { id: "ce385263_pp0_z2::2", x: 282.873909, y: 69.99010066499999, z: 2 },
        { id: "ce385267_pp0_z7_cramped::7", x: 282.873909, y: 70.039150575, z: 7 },
        { id: "ce381272_pp3_z3::3", x: 282.686409, y: 69.86340099999998, z: 3 },
        { id: "ce385261_pp0_z7::7", x: 282.74978338, y: 69.86340102, z: 7 },
      ]
  const ports = points.map((point, index) => ({
    portId: point.id,
    region1Id: regionId,
    region2Id: `outside-${index}`,
    d: { portId: point.id, x: point.x, y: point.y, z: point.z,
      distToCentermostPortOnZ: index === 2 ? 0.543236673333297 : 0,
      cramped: point.id.includes("cramped") },
  }))
  return {
    regions: [
      { regionId, pointIds: ports.map((port) => port.portId), d: structuredClone(actualRegionData) },
      ...points.map((point, index) => ({ regionId: `outside-${index}`, pointIds: [point.id],
        d: { capacityMeshNodeId: `outside-${index}`, center: { x: point.x + 1, y: point.y },
          width: 1, height: 1, availableZ: [point.z] } })),
    ],
    ports,
    connections: Array.from({ length: points.length / 2 }, (_, index) => ({
      connectionId: `actual-${sameLayer ? "same" : "cross"}-${index}`,
      mutuallyConnectedNetworkId: `net-${index}`,
      startRegionId: `outside-${index * 2}`,
      endRegionId: `outside-${index * 2 + 1}`,
    })),
    // These two-point records declare obligations; they are not routed copper.
    solvedRoutes: Array.from({ length: points.length / 2 }, (_, index) => ({
      connection: { connectionId: `actual-${sameLayer ? "same" : "cross"}-${index}` },
      path: [{ portId: points[index * 2]!.id }, { portId: points[index * 2 + 1]!.id }],
    })),
  } as SerializedHyperGraph
}

function solveGraph(graph: SerializedHyperGraph): TinyHyperGraphSolver {
  const loaded = loadSerializedHyperGraph(graph)
  const solver = new TinyHyperGraphSolver(loaded.topology, loaded.problem, {
    minViaPadDiameter: 0.3,
    STATIC_REACHABILITY_PRECHECK: true,
  })
  solver.solve()
  return solver
}

test("partial-stack domains reject the actual 74862 transitions while preserving legal layers, terminals and graph identity", () => {
  const graph = createActualPartialRegionGraph()
  const before = JSON.stringify(graph)
  const legacy = solveGraph(graph)
  expect(legacy.solved).toBe(true)
  expect(legacy.failed).toBe(false)
  const legacyChanges = legacy.state.regionSegments.flat().filter(([, a, b]) =>
    legacy.topology.portZ[a] !== legacy.topology.portZ[b])
  expect(legacyChanges).toHaveLength(2)

  expect(splitPartialLayerRegions(graph, { layerCount: 8 })).toBe(graph)
  expect(splitPartialLayerRegions(graph, { layerCount: 8, allowBlindAndBuriedVias: true })).toBe(graph)
  const split = splitPartialLayerRegions(graph, { layerCount: 8, allowBlindAndBuriedVias: false })
  expect(JSON.stringify(graph)).toBe(before)
  expect(split.connections).toEqual(graph.connections)
  expect(split.solvedRoutes?.map((route) => route.path)).toEqual(graph.solvedRoutes?.map((route) => route.path))
  expect(split.solvedRoutes?.map((route) => route.connection.connectionId)).toEqual(graph.solvedRoutes?.map((route) => route.connection.connectionId))
  expect(split.ports.map((port) => [port.portId, port.d])).toEqual(graph.ports.map((port) => [port.portId, port.d]))
  expect(split.regions).toHaveLength(graph.regions.length + actualRegionData.availableZ.length - 1)
  expect(split.regions.some((region) => region.regionId === regionId)).toBe(false)
  for (const z of actualRegionData.availableZ) {
    const region = split.regions.find((candidate) => candidate.regionId === `${regionId}::layer:${z}`)!
    expect(region).toBeDefined()
    expect(region.d).toMatchObject({ ...actualRegionData, availableZ: [z] })
    expect(region.pointIds).toEqual(graph.ports.filter((port) => port.d.z === z).map((port) => port.portId))
  }
  for (const port of split.ports) {
    expect(port.region1Id).toBe(`${regionId}::layer:${port.d.z}`)
    const original = graph.ports.find((candidate) => candidate.portId === port.portId)!
    expect(port.region2Id).toBe(original.region2Id)
    for (const incidentId of [port.region1Id, port.region2Id]) {
      const incident = split.regions.find((region) => region.regionId === incidentId)!
      expect(incident.pointIds).toContain(port.portId)
      expect(incident.d.availableZ).toContain(port.d.z)
    }
  }
  const constrained = solveGraph(split)
  expect(constrained.solved).toBe(false)
  expect(constrained.failed).toBe(true)
  expect(constrained.state.regionSegments.flat()).toHaveLength(0)

  const sameLayer = createActualPartialRegionGraph(true)
  const sameLayerSplit = splitPartialLayerRegions(sameLayer, { layerCount: 8, allowBlindAndBuriedVias: false })
  const sameLayerSolver = solveGraph(sameLayerSplit)
  expect(sameLayerSolver.solved).toBe(true)
  expect(sameLayerSolver.failed).toBe(false)
  expect(sameLayerSolver.state.regionSegments.flat()).toHaveLength(1)

  // Endpoint regions, including target reservations, must follow their declared terminal Z.
  const target = createActualPartialRegionGraph(true)
  target.connections![0]!.startRegionId = regionId
  Object.assign(target.regions[0]!.d, { _containsTarget: true, customMetadata: { preserve: true } })
  // Match the source wrapper's owned synthetic terminal side, rather than a free dead-end leaf.
  Object.assign(target.regions[1]!.d, { netId: 0, _tinyTerminal: true })
  const targetBefore = JSON.stringify(target)
  const targetSplit = splitPartialLayerRegions(target, { layerCount: 8, allowBlindAndBuriedVias: false })
  expect(targetSplit.connections![0]!.startRegionId).toBe(`${regionId}::layer:2`)
  expect(targetSplit.connections![0]!.endRegionId).toBe("outside-1")
  expect(targetSplit.connections![0]!.connectionId).toBe(target.connections![0]!.connectionId)
  expect(targetSplit.solvedRoutes?.map((route) => route.path)).toEqual(target.solvedRoutes?.map((route) => route.path))
  expect(JSON.stringify(target)).toBe(targetBefore)
  for (const region of targetSplit.regions.filter((candidate) => candidate.regionId.startsWith(`${regionId}::layer:`))) {
    expect(region.d._containsTarget).toBe(true)
    expect(region.d.customMetadata).toEqual({ preserve: true })
    expect(region.d.capacityMeshNodeId).toBe(regionId)
  }
  const targetSolver = solveGraph(targetSplit)
  expect(targetSolver.solved).toBe(true)
  const reserved = structuredClone(target)
  Object.assign(reserved.regions[0]!.d, { netId: 7, NetId: 7 })
  const reservedSplit = splitPartialLayerRegions(reserved, { layerCount: 8, allowBlindAndBuriedVias: false })
  for (const region of reservedSplit.regions.filter((candidate) => candidate.regionId.startsWith(`${regionId}::layer:`))) {
    expect(region.d.netId).toBe(7)
    expect(region.d.NetId).toBe(7)
  }

  for (const layers of [[2], [0, 1, 2, 3, 4, 5, 6, 7]]) {
    const unchanged = createActualPartialRegionGraph(true)
    unchanged.regions[0]!.d.availableZ = layers
    const unchangedBefore = JSON.stringify(unchanged)
    const output = splitPartialLayerRegions(unchanged, { layerCount: 8, allowBlindAndBuriedVias: false })
    expect(output).toEqual(unchanged)
    expect(JSON.stringify(unchanged)).toBe(unchangedBefore)
    expect(solveGraph(output).solved).toBe(true)
  }
})
