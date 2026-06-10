import { expect, test } from "bun:test"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { MultiGraphTopologyPlannerSolver } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import type { CapacityMeshNode, ConnectionPoint } from "lib/types"
import { getConnectionPointLayers } from "lib/types/srj-types"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

const BOUNDS_EPSILON = 1e-9
const OVERLAP_EPSILON = 1e-6

const getNodeBounds = (node: CapacityMeshNode) => ({
  minX: node.center.x - node.width / 2,
  maxX: node.center.x + node.width / 2,
  minY: node.center.y - node.height / 2,
  maxY: node.center.y + node.height / 2,
})

const doNodeBoundsOverlap = (nodeA: CapacityMeshNode, nodeB: CapacityMeshNode) => {
  const nodeABounds = getNodeBounds(nodeA)
  const nodeBBounds = getNodeBounds(nodeB)

  const overlapWidth =
    Math.min(nodeABounds.maxX, nodeBBounds.maxX) -
    Math.max(nodeABounds.minX, nodeBBounds.minX)
  const overlapHeight =
    Math.min(nodeABounds.maxY, nodeBBounds.maxY) -
    Math.max(nodeABounds.minY, nodeBBounds.minY)

  return overlapWidth > OVERLAP_EPSILON && overlapHeight > OVERLAP_EPSILON
}

const shareLayer = (nodeA: CapacityMeshNode, nodeB: CapacityMeshNode) =>
  nodeA.availableZ.some((z) => nodeB.availableZ.includes(z))

const doNodesTouchAtCorner = (
  nodeA: CapacityMeshNode,
  nodeB: CapacityMeshNode,
) => {
  const nodeABounds = getNodeBounds(nodeA)
  const nodeBBounds = getNodeBounds(nodeB)

  const touchesHorizontally =
    Math.abs(nodeABounds.maxX - nodeBBounds.minX) <= BOUNDS_EPSILON ||
    Math.abs(nodeABounds.minX - nodeBBounds.maxX) <= BOUNDS_EPSILON
  const touchesVertically =
    Math.abs(nodeABounds.maxY - nodeBBounds.minY) <= BOUNDS_EPSILON ||
    Math.abs(nodeABounds.minY - nodeBBounds.maxY) <= BOUNDS_EPSILON

  return touchesHorizontally && touchesVertically
}

const areNodesConnected = (nodeA: CapacityMeshNode, nodeB: CapacityMeshNode) =>
  shareLayer(nodeA, nodeB) &&
  (doNodeBoundsOverlap(nodeA, nodeB) ||
    areNodesBordering(nodeA, nodeB) ||
    doNodesTouchAtCorner(nodeA, nodeB))

const getConnectedNodeIndexes = (nodes: CapacityMeshNode[], startIndex: number) => {
  const visited = new Set<number>([startIndex])
  const queue = [startIndex]

  while (queue.length > 0) {
    const currentIndex = queue.shift()!
    const currentNode = nodes[currentIndex]!

    for (let candidateIndex = 0; candidateIndex < nodes.length; candidateIndex++) {
      if (visited.has(candidateIndex)) continue

      const candidateNode = nodes[candidateIndex]!
      if (!areNodesConnected(currentNode, candidateNode)) continue

      visited.add(candidateIndex)
      queue.push(candidateIndex)
    }
  }

  return visited
}

const getPointNodeIndexes = ({
  nodes,
  point,
  layerCount,
}: {
  nodes: CapacityMeshNode[]
  point: ConnectionPoint
  layerCount: number
}) => {
  const pointAvailableZ = getConnectionPointLayers(point).map((layer) =>
    mapLayerNameToZ(layer, layerCount),
  )

  return nodes.flatMap((node, index) => {
    if (!node.availableZ.some((z) => pointAvailableZ.includes(z))) return []

    const bounds = getNodeBounds(node)
    const containsPoint =
      point.x >= bounds.minX - BOUNDS_EPSILON &&
      point.x <= bounds.maxX + BOUNDS_EPSILON &&
      point.y >= bounds.minY - BOUNDS_EPSILON &&
      point.y <= bounds.maxY + BOUNDS_EPSILON

    return containsPoint ? [index] : []
  })
}

const getMergedTopology = async () => {
  const sample = await loadScenarioBySampleNumber("srj18", 13)
  const componentDetectionSolver = new ComponentDetectionSolver({
    inputSrj: sample.scenario,
  })
  componentDetectionSolver.solve()

  const detectedComponents = componentDetectionSolver.getOutput()
  expect(detectedComponents.length).toBeGreaterThan(0)

  const topologyPlanningSolver = new MultiGraphTopologyPlannerSolver({
    inputSrj: sample.scenario,
    componentDetectionOutput: detectedComponents,
  })
  topologyPlanningSolver.solve()

  const output = topologyPlanningSolver.getOutput()
  expect(output.mergedMeshNodes.length).toBeGreaterThan(0)

  return {
    sample,
    output,
  }
}

test("srj18 sample013 merged topology does not contain same-layer overlapping nodes", async () => {
  const { output } = await getMergedTopology()
  const mergedMeshNodes = output.mergedMeshNodes

  for (let indexA = 0; indexA < mergedMeshNodes.length; indexA++) {
    const nodeA = mergedMeshNodes[indexA]!

    expect(nodeA.width).toBeGreaterThan(OVERLAP_EPSILON)
    expect(nodeA.height).toBeGreaterThan(OVERLAP_EPSILON)
    expect(nodeA.availableZ.length).toBeGreaterThan(0)

    for (let indexB = indexA + 1; indexB < mergedMeshNodes.length; indexB++) {
      const nodeB = mergedMeshNodes[indexB]!
      if (!shareLayer(nodeA, nodeB)) continue
      if (nodeA._containsObstacle && nodeB._containsObstacle) continue

      expect(doNodeBoundsOverlap(nodeA, nodeB)).toBe(false)
    }
  }
})

test("srj18 sample013 merged topology reaches every pointsToConnect target in one BFS run", async () => {
  const { sample, output } = await getMergedTopology()
  const mergedMeshNodes = output.mergedMeshNodes

  const pointNodeIndexes = sample.scenario.connections.flatMap((connection) =>
    connection.pointsToConnect.map((point) => ({
      connectionName: connection.name,
      point,
      nodeIndexes: getPointNodeIndexes({
        nodes: mergedMeshNodes,
        point,
        layerCount: sample.scenario.layerCount,
      }),
    })),
  )

  for (const pointNodeIndex of pointNodeIndexes) {
    expect(pointNodeIndex.nodeIndexes.length).toBeGreaterThan(0)
  }

  const bfsStartIndex = pointNodeIndexes[0]!.nodeIndexes[0]!
  const reachableNodeIndexes = getConnectedNodeIndexes(mergedMeshNodes, bfsStartIndex)

  for (const pointNodeIndex of pointNodeIndexes) {
    const isReachable = pointNodeIndex.nodeIndexes.some((nodeIndex) =>
      reachableNodeIndexes.has(nodeIndex),
    )

    expect(isReachable).toBe(true)
  }
})
