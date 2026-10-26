import { expect, test } from "bun:test"
import type { PhysicalViaCapacityContext } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createPhysicalViaCapacityEvaluator"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

test("trace domains use all real producer rectangles while via capacity retains the strict free-node scope", async (): Promise<void> => {
  const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import(
    "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
  )
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 10, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 1, y: 0, layer: "top", pointId: "pad-port" },
          { x: 2, y: 0, layer: "top", pointId: "pth-port" },
        ],
      },
    ],
  }
  const parent: CapacityMeshNode = {
    capacityMeshNodeId: "producer-parent",
    layer: "top",
    center: { x: 3, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
  }
  const nodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "free",
      layer: "top",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0, 1],
    },
    {
      capacityMeshNodeId: "pad",
      layer: "top",
      center: { x: 1, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0],
      _containsTarget: true,
      _connectedTo: ["signal"],
    },
    {
      capacityMeshNodeId: "pth",
      layer: "top",
      center: { x: 2, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0, 1],
      _containsTarget: true,
      _containsObstacle: true,
      _connectedTo: ["signal"],
    },
    {
      capacityMeshNodeId: "parented",
      layer: "top",
      center: { x: 3, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0, 1],
      _parent: parent,
    },
    {
      capacityMeshNodeId: "virtual",
      layer: "top",
      center: { x: 4, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0, 1],
      _isVirtualOffboard: true,
    },
    {
      capacityMeshNodeId: "offboard",
      layer: "top",
      center: { x: 5, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0, 1],
      _offBoardConnectionId: "external",
    },
  ]
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  pipeline.capacityNodes = nodes
  pipeline.srjWithPointPairs = { ...srj, connections: [] }
  pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints = []
  const step = pipeline.pipelineDef.find(
    (candidate) => candidate.solverName === "portPointPathingSolver",
  )!
  const params = step.getConstructorParams(pipeline)[0] as {
    physicalViaCapacity: PhysicalViaCapacityContext
  }
  expect(params.physicalViaCapacity.sharedEdgeRegionIds).toEqual([
    "free",
    "pad",
    "pth",
    "parented",
  ])
  expect(params.physicalViaCapacity.freeRegionIds).toEqual(["free"])
  expect(params.physicalViaCapacity.movableSharedEdgeRegionIds).toEqual(["free", "parented"])
  expect(params.physicalViaCapacity.planningObstacles).toEqual(srj.obstacles)
  expect(params.physicalViaCapacity.preserveSolitarySharedEdgePorts).toBe(false)
  expect(structuredClone(params.physicalViaCapacity)).toEqual(
    params.physicalViaCapacity,
  )
})
