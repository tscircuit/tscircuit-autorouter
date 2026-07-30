import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import type { CapacityMeshEdge, CapacityMeshNode } from "lib/types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import {
  createTopologyMergingSolverFromPlanning,
  createTopologyPlanningSolverForMerging,
} from "tests/fixtures/topology-merging-test-utils"
import {
  createSrj24Sample4TopologyFixture,
  visualizeLayerAccess,
  visualizeMixedComponent,
} from "./fixtures/srj24-sample4-topology.fixture"

function getShortestPath({
  nodes,
  edges,
  startNode,
  endNode,
  allowedNodeIds,
}: {
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
  startNode: CapacityMeshNode
  endNode: CapacityMeshNode
  allowedNodeIds: ReadonlySet<string>
}): CapacityMeshNode[] | null {
  const nodeById = new Map(nodes.map((node) => [node.capacityMeshNodeId, node]))
  const adjacentNodeIds = new Map<string, string[]>()
  for (const edge of edges) {
    const [firstNodeId, secondNodeId] = edge.nodeIds
    if (!allowedNodeIds.has(firstNodeId) || !allowedNodeIds.has(secondNodeId)) {
      continue
    }
    adjacentNodeIds.set(firstNodeId, [
      ...(adjacentNodeIds.get(firstNodeId) ?? []),
      secondNodeId,
    ])
    adjacentNodeIds.set(secondNodeId, [
      ...(adjacentNodeIds.get(secondNodeId) ?? []),
      firstNodeId,
    ])
  }

  const previousNodeId = new Map<string, string>()
  const visitedNodeIds = new Set([startNode.capacityMeshNodeId])
  const pendingNodeIds = [startNode.capacityMeshNodeId]
  while (pendingNodeIds.length > 0) {
    const nodeId = pendingNodeIds.shift()!
    if (nodeId === endNode.capacityMeshNodeId) break
    for (const adjacentNodeId of adjacentNodeIds.get(nodeId) ?? []) {
      if (visitedNodeIds.has(adjacentNodeId)) continue
      visitedNodeIds.add(adjacentNodeId)
      previousNodeId.set(adjacentNodeId, nodeId)
      pendingNodeIds.push(adjacentNodeId)
    }
  }
  if (!visitedNodeIds.has(endNode.capacityMeshNodeId)) return null

  const pathNodeIds = [endNode.capacityMeshNodeId]
  while (pathNodeIds[0] !== startNode.capacityMeshNodeId) {
    pathNodeIds.unshift(previousNodeId.get(pathNodeIds[0]!)!)
  }
  return pathNodeIds.map((nodeId) => nodeById.get(nodeId)!)
}

test("shows the srj24 sample 4 topology gap", async (): Promise<void> => {
  const fixture = createSrj24Sample4TopologyFixture()
  const componentDetectionSolver = new ComponentDetectionSolver({
    inputSrj: fixture.inputSrj,
  })
  componentDetectionSolver.solve()
  const detectedBga = componentDetectionSolver
    .getOutput()
    .find((component) => component.componentId === "mixed-pad-bga")

  const topologyPlanningSolver = createTopologyPlanningSolverForMerging(
    fixture.inputSrj,
  )
  topologyPlanningSolver.solve()
  const topologyPlanningOutput = topologyPlanningSolver.getOutput()
  const topologyMergingSolver = createTopologyMergingSolverFromPlanning({
    inputSrj: fixture.inputSrj,
    topologyPlanningSolver,
  })
  topologyMergingSolver.solve()
  const subdivisionSolver = new NodeDimensionSubdivisionSolver(
    topologyMergingSolver.getOutput(),
    16,
    6,
    0.01,
  )
  subdivisionSolver.solve()
  const edgeSolver = new CapacityMeshEdgeSolver2_NodeTreeOptimization(
    subdivisionSolver.outputNodes,
  )
  edgeSolver.solve()

  const topTarget = subdivisionSolver.outputNodes.find(
    (node) =>
      node._containsTarget &&
      Math.abs(node.center.x) < 1e-6 &&
      Math.abs(node.center.y) < 1e-6,
  )!
  const bottomTarget = subdivisionSolver.outputNodes.find(
    (node) =>
      node._containsTarget &&
      Math.abs(node.center.x - 0.17) < 1e-6 &&
      Math.abs(node.center.y) < 1e-6,
  )!
  const componentNodeIds = new Set(
    subdivisionSolver.outputNodes
      .filter((node) => node._isComponentTopologyNode || node._containsTarget)
      .map((node) => node.capacityMeshNodeId),
  )
  const shortestPath = getShortestPath({
    nodes: subdivisionSolver.outputNodes,
    edges: edgeSolver.edges,
    startNode: topTarget,
    endNode: bottomTarget,
    allowedNodeIds: componentNodeIds,
  })

  const globalObstacleIds = new Set(
    topologyPlanningOutput.globalNoConnectionSrj.obstacles.map(
      (obstacle) => obstacle.obstacleId,
    ),
  )
  const detectedCoreObstacleIds = new Set(
    detectedBga
      ? fixture.inputSrj.obstacles
          .filter(
            (obstacle) =>
              obstacle.componentId === detectedBga.componentId &&
              obstacle.center.x >= detectedBga.bounds.minX &&
              obstacle.center.x <= detectedBga.bounds.maxX &&
              obstacle.center.y >= detectedBga.bounds.minY &&
              obstacle.center.y <= detectedBga.bounds.maxY,
          )
          .map((obstacle) => obstacle.obstacleId!)
      : [],
  )
  const hasDetectedBga = detectedBga !== undefined

  expect(shortestPath !== null).toBe(hasDetectedBga)
  expect(
    [...fixture.nonCoreObstacleIds].every((obstacleId) =>
      globalObstacleIds.has(obstacleId),
    ),
  ).toBe(true)
  expect(
    [...fixture.bgaCoreObstacleIds].every((obstacleId) =>
      globalObstacleIds.has(obstacleId),
    ),
  ).toBe(!hasDetectedBga)
  expect(
    shortestPath?.some((node) => node.availableZ.length > 1) ?? false,
  ).toBe(hasDetectedBga)

  const displayedPath = shortestPath ?? [topTarget, bottomTarget]
  const routeNodes = displayedPath.map((node, index) => ({
    ...node,
    capacityMeshNodeId: `route-${index}`,
    _isBgaViaRegion: node.availableZ.length > 1,
  }))
  const routeEdges = shortestPath
    ? routeNodes.slice(1).map((node, index) => ({
        capacityMeshEdgeId: `route-edge-${index}`,
        nodeIds: [
          routeNodes[index]!.capacityMeshNodeId,
          node.capacityMeshNodeId,
        ] as [string, string],
      }))
    : []
  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Input: mixed pad package",
        step: 0,
        iteration: 0,
        graphics: visualizeMixedComponent({ inputSrj: fixture.inputSrj }),
      },
      {
        name: hasDetectedBga
          ? "Fix 1: BGA core detected"
          : "Issue 1: BGA core not detected",
        step: 1,
        iteration: componentDetectionSolver.iterations,
        graphics: visualizeMixedComponent({
          inputSrj: fixture.inputSrj,
          selectedObstacleIds: detectedCoreObstacleIds,
        }),
      },
      {
        name: hasDetectedBga
          ? "Fix 2: core local, perimeter global"
          : "Issue 2: all pads stay global",
        step: 2,
        iteration: topologyPlanningSolver.iterations,
        graphics: visualizeMixedComponent({
          inputSrj: fixture.inputSrj,
          selectedObstacleIds: detectedCoreObstacleIds,
          globalObstacleIds,
        }),
      },
      {
        name: shortestPath
          ? "Result: BGA-local z0-to-z5 path"
          : "Failure: no BGA-local z0-to-z5 path",
        step: 3,
        iteration: topologyMergingSolver.iterations,
        graphics: visualizeLayerAccess({
          nodes: routeNodes,
          edges: routeEdges,
        }),
      },
    ],
    columns: 2,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
})
