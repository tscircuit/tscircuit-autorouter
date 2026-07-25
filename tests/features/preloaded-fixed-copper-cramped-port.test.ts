import { expect, test } from "bun:test"
import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

const createCrampedPort = (
  id: string,
  nodeIds: [string, string],
): SegmentPortPoint => ({
  segmentPortPointId: id,
  x: 0,
  y: 0,
  availableZ: [0],
  nodeIds,
  edgeId: `edge-${id}`,
  connectionName: null,
  distToCentermostPortOnZ: 0,
  cramped: true,
})

const createSegment = (
  id: string,
  nodeIds: [string, string],
): SharedEdgeSegment => ({
  edgeId: `edge-${id}`,
  nodeIds,
  start: { x: 0, y: -0.05 },
  end: { x: 0, y: 0.05 },
  availableZ: [0],
  portPoints: [createCrampedPort(id, nodeIds)],
})

test("preloaded fixed copper keeps incident cramped graph ports", () => {
  const capacityMeshNodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "fixed",
      center: { x: -0.05, y: 0 },
      width: 0.1,
      height: 0.1,
      layer: "top",
      availableZ: [0],
      _preloadedFixedNetIds: ["fixed-net"],
    },
    {
      capacityMeshNodeId: "free-neighbor",
      center: { x: 0.05, y: 0 },
      width: 0.1,
      height: 0.1,
      layer: "top",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "unrelated-free-a",
      center: { x: 1, y: 0 },
      width: 0.1,
      height: 0.1,
      layer: "top",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "unrelated-free-b",
      center: { x: 1.1, y: 0 },
      width: 0.1,
      height: 0.1,
      layer: "top",
      availableZ: [0],
    },
  ]
  const sharedEdgeSegments = [
    createSegment("fixed-escape", ["fixed", "free-neighbor"]),
    createSegment("unrelated", ["unrelated-free-a", "unrelated-free-b"]),
  ]
  const simpleRouteJson: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  }
  const solver = new MultiTargetNecessaryCrampedPortPointSolver({
    sharedEdgeSegments,
    capacityMeshNodes,
    simpleRouteJson,
    numberOfCrampedPortPointsToKeep: 1,
  })

  solver.solve()

  const outputByEdgeId = new Map(
    solver.getOutput().map((segment) => [segment.edgeId, segment]),
  )
  expect(outputByEdgeId.get("edge-fixed-escape")?.portPoints).toEqual([
    expect.objectContaining({
      segmentPortPointId: "fixed-escape",
      tinyHypergraphPortPenalty: 1_000,
    }),
  ])
  expect(outputByEdgeId.get("edge-unrelated")?.portPoints).toEqual([])
})
