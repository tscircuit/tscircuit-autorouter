import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { createPhysicalNodeCutNativeInput } from "../fixtures/tinygraph/createPhysicalNodeCutNativeInput"
import { createPhysicalWrapperProblem } from "../fixtures/tinygraph/createPhysicalWrapperProblem"

test("eight same-net branches can share the seven original finite-cut sites without an outside route", (): void => {
  const input = createPhysicalNodeCutNativeInput(true)
  const originalNodes = structuredClone(input.nodes)
  const originalConnections = structuredClone(input.connections)
  const originalContext = structuredClone(input.context)
  expect(input.context.routableNetIds.size).toBe(1)
  expect(
    input.nodes.some(
      (node): boolean => node.capacityMeshNodeId === "outside-west",
    ),
  ).toBeFalse()
  const subdivision = new NodeDimensionSubdivisionSolver(
    input.nodes,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    0.01,
    input.context,
  )
  subdivision.solve()
  expect(subdivision.outputPhysicalCuts).toHaveLength(3)
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
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes: subdivision.outputNodes,
    segmentPortPoints: [...available.portPointMap.values()],
    simpleRouteJsonConnections: input.connections,
    connectivityMap: input.connectivityMap,
    layerCount: input.context.layerCount,
  })
  const originalGraph = structuredClone(graph)
  const originalGraphConnections = structuredClone(connections)
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
  const initialNative =
    solver["tinyPipelineSolver"].getSolver<TinyHyperGraphSolver>("solveGraph")
  if (initialNative === undefined) {
    throw new Error("The initial native routing stage was not retained")
  }
  // The final section stage replays solved assignments; the initial routing
  // stage must have solved these routes without any preloaded assignments.
  expect(initialNative.problem.initialAssignments ?? []).toEqual([])
  expect(initialNative.solved).toBeTrue()
  expect(initialNative.state.unroutedRoutes).toEqual([])
  const native = solver["getSolvedTinySolver"]()
  expect(native.problem.routeCount).toBe(8)
  expect(new Set(native.problem.routeNet).size).toBe(1)
  expect(native.state.unroutedRoutes).toEqual([])
  const cutRoutes = new Map<string, Set<number>>()
  const siteRoutes = new Map<number, Set<number>>()
  for (const segments of native.state.regionSegments) {
    for (const [routeId, fromPortId, toPortId] of segments) {
      for (const portId of [fromPortId, toPortId]) {
        const cutId: unknown =
          native.topology.portMetadata?.[portId]?.physicalCutId
        if (typeof cutId !== "string") continue
        if (!cutRoutes.has(cutId)) cutRoutes.set(cutId, new Set<number>())
        if (!siteRoutes.has(portId)) siteRoutes.set(portId, new Set<number>())
        cutRoutes.get(cutId)!.add(routeId)
        siteRoutes.get(portId)!.add(routeId)
      }
    }
  }
  for (const cut of subdivision.outputPhysicalCuts) {
    expect(
      native.topology.portMetadata!.filter(
        (metadata): boolean => metadata.physicalCutId === cut.physicalCutId,
      ),
    ).toHaveLength(7)
    expect(cutRoutes.get(cut.physicalCutId)?.size).toBe(8)
  }
  expect(
    [...siteRoutes.values()].some((routes): boolean => routes.size > 1),
  ).toBeTrue()
  expect(solver.getOutput().changedPreloadedTraceSections).toEqual([])
  expect(input.nodes).toEqual(originalNodes)
  expect(input.connections).toEqual(originalConnections)
  expect(input.context).toEqual(originalContext)
  expect(graph).toEqual(originalGraph)
  expect(connections).toEqual(originalGraphConnections)
})
