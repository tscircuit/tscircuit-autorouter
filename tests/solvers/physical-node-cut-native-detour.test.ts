import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { createPhysicalNodeCutNativeInput } from "../fixtures/tinygraph/createPhysicalNodeCutNativeInput"
import { createPhysicalWrapperProblem } from "../fixtures/tinygraph/createPhysicalWrapperProblem"

test("native routing respects produced four-plus-three cut sites and sends excess distinct nets outside", (): void => {
  const input = createPhysicalNodeCutNativeInput()
  const originalNodes = structuredClone(input.nodes)
  const originalConnections = structuredClone(input.connections)
  const originalContext = structuredClone(input.context)
  expect(input.context.routableNetIds.size).toBe(8)
  expect(
    input.context.protectedPoints.every(({ y }): boolean => Math.abs(y) === 3),
  ).toBeTrue()
  const subdivision = new NodeDimensionSubdivisionSolver(
    input.nodes,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    0.01,
    input.context,
  )
  subdivision.solve()
  expect(subdivision.solved).toBeTrue()
  expect(subdivision.failed).toBeFalse()
  expect(subdivision.outputPhysicalCuts).toHaveLength(3)
  expect(
    subdivision.outputNodes.some(
      (node): boolean => node.capacityMeshNodeId === "outside-west",
    ),
  ).toBeTrue()
  const edges = new CapacityMeshEdgeSolver(subdivision.outputNodes)
  edges.solve()
  const available = new AvailableSegmentPointSolver({
    nodes: subdivision.outputNodes,
    edges: edges.edges,
    traceWidth: input.context.traceWidth,
    obstacleMargin: input.context.traceGap,
    shouldReturnCrampedPortPoints: true,
    physicalNodeCuts: {
      context: input.context,
      cuts: subdivision.outputPhysicalCuts,
    },
  })
  available.solve()
  expect(available.solved).toBeTrue()
  const segmentPortPoints = [...available.portPointMap.values()]
  for (const cut of subdivision.outputPhysicalCuts) {
    const sites = segmentPortPoints.filter(
      (port): boolean => port.physicalCutId === cut.physicalCutId,
    )
    expect(sites).toHaveLength(7)
    expect(
      sites.filter((port): boolean => port.availableZ[0] === 0),
    ).toHaveLength(4)
    expect(
      sites.filter((port): boolean => port.availableZ[0] === 1),
    ).toHaveLength(3)
  }
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes: subdivision.outputNodes,
    segmentPortPoints,
    simpleRouteJsonConnections: input.connections,
    connectivityMap: input.connectivityMap,
    layerCount: input.context.layerCount,
  })
  const solver = new TinyHypergraphPortPointPathingSolver({
    ...createPhysicalWrapperProblem(),
    graph,
    connections,
    layerCount: input.context.layerCount,
    physicalClearance: {
      traceWidth: input.context.traceWidth,
      clearanceIndex: new FixedCopperClearanceIndex({
        rectangles: input.context.rectangles,
        layerCount: input.context.layerCount,
        minClearance: input.context.padGap,
      }),
    },
  })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const native = solver["getSolvedTinySolver"]()
  expect(native.problem.routeCount).toBe(8)
  expect(new Set(native.problem.routeNet).size).toBe(8)
  expect(native.problem.initialAssignments ?? []).toEqual([])
  expect(native.state.unroutedRoutes).toEqual([])
  for (let routeId = 0; routeId < native.problem.routeCount; routeId++) {
    const connectionId: unknown =
      native.problem.routeMetadata?.[routeId]?.connectionId
    const source = input.connections.find(
      (connection): boolean => connection.name === connectionId,
    )
    if (source === undefined) {
      throw new Error(`Native route ${routeId} lost its original source`)
    }
    for (const [pointIndex, portId] of [
      [0, native.problem.routeStartPort[routeId]!],
      [1, native.problem.routeEndPort[routeId]!],
    ]) {
      const point = source.pointsToConnect[pointIndex!]!
      expect(native.topology.portX[portId!]).toBe(point.x)
      expect(native.topology.portY[portId!]).toBe(point.y)
      expect(native.topology.portZ[portId!]).toBe(0)
    }
  }
  const cutNets = new Map<string, Set<number>>()
  const siteNets = new Map<number, Set<number>>()
  const outsideRoutes = new Set<number>()
  for (const [regionId, segments] of native.state.regionSegments.entries()) {
    for (const [routeId, fromPortId, toPortId] of segments) {
      if (
        native.topology.regionMetadata?.[regionId]?.capacityMeshNodeId ===
        "outside-west"
      ) {
        outsideRoutes.add(routeId)
      }
      for (const portId of [fromPortId, toPortId]) {
        const cutId: unknown =
          native.topology.portMetadata?.[portId]?.physicalCutId
        if (typeof cutId !== "string") continue
        const netId = native.problem.routeNet[routeId]!
        if (!cutNets.has(cutId)) cutNets.set(cutId, new Set<number>())
        if (!siteNets.has(portId)) siteNets.set(portId, new Set<number>())
        cutNets.get(cutId)!.add(netId)
        siteNets.get(portId)!.add(netId)
      }
    }
  }
  expect(cutNets.size).toBeGreaterThan(0)
  expect(outsideRoutes.size).toBeGreaterThan(0)
  for (const cut of subdivision.outputPhysicalCuts) {
    const loadedSites = native.topology.portMetadata!.filter(
      (metadata): boolean => metadata.physicalCutId === cut.physicalCutId,
    )
    expect(loadedSites).toHaveLength(7)
    expect(
      loadedSites.every(
        (metadata): boolean => metadata.duplicatedFromPortId === undefined,
      ),
    ).toBeTrue()
    expect(cutNets.get(cut.physicalCutId)?.size ?? 0).toBeLessThanOrEqual(7)
  }
  for (const owners of siteNets.values()) expect(owners.size).toBe(1)
  expect(solver.getOutput().changedPreloadedTraceSections).toEqual([])
  expect(input.nodes).toEqual(originalNodes)
  expect(input.connections).toEqual(originalConnections)
  expect(input.context).toEqual(originalContext)
})
